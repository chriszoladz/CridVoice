//! Provider keys are DPAPI-encrypted before entering Windows Credential Manager.
use base64::{engine::general_purpose::STANDARD, Engine};
use windows::Win32::{
    Foundation::{LocalFree, HLOCAL},
    Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    },
};
use zeroize::{Zeroize, Zeroizing};
const PREFIX: &str = "CridVoice:dpapi:v1:";
fn entropy(id: &str) -> Vec<u8> {
    format!("CridVoice.provider-key.v1:{id}").into_bytes()
}
fn crypt(input: &[u8], id: &str, encrypt: bool) -> Result<Zeroizing<Vec<u8>>, String> {
    let extra = entropy(id);
    let input = CRYPT_INTEGER_BLOB {
        cbData: input
            .len()
            .try_into()
            .map_err(|_| "API key is too large.")?,
        pbData: input.as_ptr() as *mut u8,
    };
    let extra = CRYPT_INTEGER_BLOB {
        cbData: extra.len() as u32,
        pbData: extra.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    unsafe {
        let result = if encrypt {
            CryptProtectData(
                &input,
                None,
                Some(&extra),
                None,
                None,
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        } else {
            CryptUnprotectData(
                &input,
                None,
                Some(&extra),
                None,
                None,
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        };
        result.map_err(|_| {
            if encrypt {
                "Windows could not encrypt this API key.".to_string()
            } else {
                "Windows could not decrypt this API key. Re-enter it on this Windows account."
                    .to_string()
            }
        })?;
        if output.pbData.is_null() || output.cbData == 0 {
            if !output.pbData.is_null() {
                let _ = LocalFree(Some(HLOCAL(output.pbData.cast())));
            }
            return Err("Windows returned an empty protected key record.".into());
        }
        let bytes = Zeroizing::new(
            std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec(),
        );
        // Wipe the decrypted OS allocation before returning it to Windows.
        if !encrypt {
            std::slice::from_raw_parts_mut(output.pbData, output.cbData as usize).zeroize();
        }
        let _ = LocalFree(Some(HLOCAL(output.pbData.cast())));
        Ok(bytes)
    }
}
fn protect(key: &str, id: &str) -> Result<String, String> {
    Ok(format!(
        "{PREFIX}{}",
        STANDARD.encode(&*crypt(key.as_bytes(), id, true)?)
    ))
}
fn unprotect(value: &str, id: &str) -> Result<Zeroizing<String>, String> {
    let encoded = value
        .strip_prefix(PREFIX)
        .ok_or("This stored key needs to be re-entered to use CridVoice's encrypted key format.")?;
    let encrypted = STANDARD
        .decode(encoded)
        .map_err(|_| "Stored API key is damaged; re-enter it.")?;
    let bytes = crypt(&encrypted, id, false)?;
    let text =
        std::str::from_utf8(&bytes).map_err(|_| "Decrypted API key is invalid; re-enter it.")?;
    Ok(Zeroizing::new(text.to_owned()))
}
fn entry(id: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new("CridVoice", id)
        .map_err(|_| "Windows Credential Manager is unavailable.".into())
}
pub fn read(id: &str) -> Result<Zeroizing<String>, String> {
    match entry(id)?.get_password() {
        Ok(value) => unprotect(&value, id),
        Err(keyring::Error::NoEntry) => Ok(Zeroizing::new(String::new())),
        Err(_) => Err("Windows Credential Manager could not read this provider key.".into()),
    }
}
pub fn write(id: &str, key: &str) -> Result<(), String> {
    let entry = entry(id)?;
    if key.is_empty() {
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err("Could not remove the provider key.".into()),
        }
    } else {
        if key.len() > 2500 {
            return Err("API key exceeds the Windows credential size limit.".into());
        }
        entry
            .set_password(&protect(key, id)?)
            .map_err(|_| "Windows Credential Manager could not save the encrypted API key.".into())
    }
}
pub fn has_key(id: &str) -> bool {
    entry(id)
        .and_then(|e| e.get_password().map_err(|_| String::new()))
        .is_ok_and(|v| !v.is_empty())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn dpapi_is_provider_bound_and_never_stores_raw_key() {
        let key = "cridvoice-encryption-test-value";
        let cipher = protect(key, "provider-a").unwrap();
        assert!(cipher.starts_with(PREFIX));
        assert!(!cipher.contains(key));
        assert_eq!(unprotect(&cipher, "provider-a").unwrap().as_str(), key);
        assert!(unprotect(&cipher, "provider-b").is_err());
        assert!(unprotect(key, "provider-a").is_err());
    }
    #[test]
    fn credential_manager_round_trip_stores_only_provider_bound_ciphertext() {
        struct TestCredential(String);
        impl Drop for TestCredential {
            fn drop(&mut self) {
                let _ = write(&self.0, "");
            }
        }
        let record = TestCredential(format!("test-{}", uuid::Uuid::new_v4()));
        let key = "cridvoice-dummy-credential-round-trip";
        write(&record.0, key).unwrap();
        let stored = entry(&record.0).unwrap().get_password().unwrap();
        assert!(stored.starts_with(PREFIX));
        assert!(!stored.contains(key));
        assert_eq!(read(&record.0).unwrap().as_str(), key);
        assert!(unprotect(&stored, "different-test-provider").is_err());
        write(&record.0, "").unwrap();
        assert!(read(&record.0).unwrap().is_empty());
    }
}
