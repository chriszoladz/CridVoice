use cridvoice_lib::{
    config::Settings,
    core::{cleanup_messages, Context},
};
use serde_json::json;

type Fixture = (
    &'static str,
    &'static str,
    &'static str,
    &'static str,
    &'static str,
    &'static str,
    &'static str,
);

fn fixtures() -> [Fixture; 11] {
    [
        ("python_function", "code", "", "code", "sample.py - Visual Studio Code", "", "def, add open parenthesis a comma b close parenthesis colon new line indent four spaces return a plus b"),
        ("cli_git", "code", "", "WindowsTerminal", "Terminal", "bash-5.2$ ", "git switch double dash create feature slash voice"),
        ("literal-powershell-path", "code", "", "WindowsTerminal", "Terminal", "PS C:\\fixture> ", "Set-Location space double quote C colon backslash Fixture Space Logs close double quote"),
        ("literal-typescript", "code", "", "code", "sample.ts - Visual Studio Code", "", "const count equals items dot length semicolon"),
        ("literal-rust", "code", "", "code", "sample.rs - Visual Studio Code", "", "let total colon u thirty two equals three semicolon"),
        ("literal-sql", "code", "SQL", "code", "query.sql - Visual Studio Code", "", "select id from logs where level equals single quote error close single quote semicolon"),
        ("manual-python-over-rust", "code", "Python", "code", "sample.rs - Visual Studio Code", "", "print open parenthesis double quote ready close double quote close parenthesis"),
        ("generate-python", "generate", "", "code", "sample.py - Visual Studio Code", "", "Write a Python function named add that accepts a and b and returns their sum."),
        ("generate-powershell-logs", "generate", "", "WindowsTerminal", "Terminal", "PS C:\\fixture> ", "Create a PowerShell command that lists all dot log files recursively in the current folder."),
        ("cli-asr-python-context", "code", "", "code", "sample.py - Visual Studio Code", "def add(a, b): return a + b", "Git status. Git switch double dash create feature name"),
        ("cli-spoken-dot", "code", "", "code", "sample.py - Visual Studio Code", "def add(a, b): return a + b", "Git add dot"),
    ]
}

fn fixture_context(
    (_, mode, language, app, title, nearby, transcript): Fixture,
) -> (Settings, Context, &'static str) {
    let mut settings = Settings::default();
    settings.cleanup.output_mode = mode.into();
    settings.cleanup.code_language = language.into();
    let context = Context {
        app: app.into(),
        window_title: title.into(),
        nearby: nearby.into(),
        ..Default::default()
    };
    (settings, context, transcript)
}

fn main() {
    let fixtures = fixtures();
    let args: Vec<_> = std::env::args().collect();
    if args.get(1).is_some_and(|arg| arg == "--normalize-replies") {
        let input: serde_json::Value = serde_json::from_slice(
            &std::fs::read(args.get(2).expect("Provide a public fixture replies file.")).unwrap(),
        )
        .unwrap();
        let cases = input
            .as_array()
            .or_else(|| input["cases"].as_array())
            .expect("Provide an array of cases.");
        let outputs: Vec<_> = cases.iter().map(|case| {
            let mode = case["mode"].as_str().unwrap_or("code");
            let protocol = case["protocol"].as_str().unwrap_or("openai");
            let response = if let Some(text) = case["response"].as_str() {
                if protocol == "anthropic" {
                    json!({"content":[{"type":"text","text":text}]})
                } else {
                    json!({"choices":[{"message":{"content":text}}]})
                }
            } else { case["response"].clone() };
            match cridvoice_lib::core::extract_output(protocol, &response, mode) {
                Ok(output) => {
                    let id = case["id"].as_str().unwrap_or("");
                    let fixture = fixtures.iter().find(|fixture| fixture.0 == id);
                    let model_tag = output.coding_language.clone();
                    let (output, effective) = if let Some(fixture) = fixture {
                        let (settings, context, transcript) = fixture_context(*fixture);
                        let output = cridvoice_lib::coding::normalize_output(&settings, transcript, false, output);
                        let effective = cridvoice_lib::coding::output_language(&settings, transcript, &context, model_tag.clone());
                        (output, effective)
                    } else { (output, None) };
                    json!({"id":case["id"],"mode":mode,"text":output.text,"codingLanguage":model_tag,"modelLanguageTag":model_tag,"effectiveCodingLanguage":effective,"fixtureKnown":fixture.is_some()})
                },
                Err(error) => json!({"id":case["id"],"mode":mode,"error":error}),
            }
        }).collect();
        println!("{}", serde_json::to_string_pretty(&outputs).unwrap());
        return;
    }
    let outputs: Vec<_> = fixtures
        .into_iter()
        .map(|fixture| {
            let (settings, context, transcript) = fixture_context(fixture);
            let (system, user) = cleanup_messages(&settings, transcript, &context, false);
            json!({"id": fixture.0, "mode": fixture.1, "system": system, "user": user,"temperature":cridvoice_lib::core::cleanup_temperature(fixture.1)})
        })
        .collect();
    let warmup_mode = if args.get(1).is_some_and(|arg| arg == "--warmup-mode") {
        args.get(2).map(String::as_str).unwrap_or("code")
    } else {
        "code"
    };
    println!(
        "{}",
        serde_json::to_string_pretty(&json!({
            "warmup":cridvoice_lib::core::cleanup_warmup_payload(warmup_mode),
            "cases":outputs
        }))
        .unwrap()
    );
}
