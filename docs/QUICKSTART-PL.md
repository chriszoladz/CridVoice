# CridVoice: szybki start

CridVoice to osobista aplikacja do dyktowania na Windows 11. Rozpoznawanie mowy i redagowanie tekstu mogą działać lokalnie na karcie NVIDIA albo procesorze Intel/AMD. Chmura jest używana wyłącznie po wybraniu odpowiedniego dostawcy.

1. Uruchom instalator `.exe` albo rozpakuj **cały** przenośny ZIP i uruchom `CridVoice.exe`. Python jest dołączony.
2. W kreatorze wybierz modele zarządzane przez aplikację, własny serwer LM Studio/llama.cpp albo dostawcę API.
3. Wybierz osobno rozpoznawanie mowy i redagowanie tekstu. Na końcu kreatora sprawdź listę wszystkich wymaganych składników i rozmiar pobierania. Domyślna konfiguracja lokalna na RTX 5070 Ti wymaga Whisper Large v3 Turbo, bibliotek NVIDIA, Qwen3 4B i silnika llama.cpp GPU.
4. Kliknij **Install required components & finish**. Kreator automatycznie pobierze brakujące składniki i pozostanie otwarty podczas pobierania, sprawdzania i rozpakowywania. Postęp jest widoczny dla każdego składnika i całości. Zainstalowane składniki zostaną wykorzystane ponownie. **Pause setup**, **Resume setup** oraz **Retry setup** pozwalają zatrzymać i wznowić pracę bez utraty prawidłowych części pobranych plików. Konfiguracja kończy się dopiero po potwierdzeniu gotowości wszystkich wybranych składników.
5. Kliknij pole tekstowe w innej aplikacji. Przytrzymaj **Ctrl + Windows**, powiedz tekst, a następnie zwolnij oba klawisze. CridVoice przetworzy i wpisze wynik.
6. **Ctrl + Shift + Space** włącza/wyłącza nagrywanie. **Escape** anuluje. Aby poprawić zaznaczony tekst, użyj **Ctrl + Alt + R**, powiedz polecenie i naciśnij skrót ponownie.

Jeśli w istniejącej konfiguracji brakuje wybranych składników lokalnych, aplikacja otworzy naprawę konfiguracji na końcowej liście. Możesz też użyć **Settings → Run setup wizard**. Kreator zachowuje wybranych dostawców mowy i tekstu, zapisane klucze oraz pozostałe ustawienia. Puste pole zapisanego klucza nie usuwa go. Konfiguracja oparta wyłącznie na dostawcach API nie wymaga modeli lokalnych. Podgląd w przeglądarce nie może potwierdzić gotowości modeli lokalnych.

Automatyczne rozpoznawanie angielskiego i polskiego jest domyślne. W razie potrzeby wybierz **Polski** ręcznie. W Vocabulary dodawaj własne nazwy i pisownię, np. „Łukasz”. Writing styles pozwala wybrać styl dla poszczególnych aplikacji.

Tekst transkrypcji jest zapisywany lokalnie w History. Nagrania audio nie są przechowywane jako historia. Appearance zawiera osiem motywów, tryb jasny/ciemny/systemowy oraz przełączniki fali dźwiękowej, podglądu tekstu i paska nagrywania.

Nie zmieniaj aktywnego pola przed zakończeniem przetwarzania. Jeśli fokus się zmieni, wynik zostanie zapisany zamiast wpisany do innego pola. Dokładność i rozumienie poprawek zależą od wybranych modeli. Przetestuj aplikację na swoim Windows 11 zgodnie z [listą testów](WINDOWS-TESTING.md).
