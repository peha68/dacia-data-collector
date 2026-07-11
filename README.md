# Dacia Data Collector

Nieoficjalna aplikacja Node.js pobierająca dane pojazdu z usług Dacia/Renault i wysyłająca dzienny raport JSON przez Gmail.

> Projekt korzysta z nieudokumentowanych endpointów producenta. Nie jest powiązany z Renault Group, Dacia, Home Assistant ani Google.

## Funkcje

- logowanie do konta My Dacia przez Gigya,
- wyszukiwanie pojazdu po VIN,
- pobieranie przebiegu, ilości paliwa i lokalizacji,
- szacowanie zasięgu benzyny oraz LPG,
- endpoint HTTP z aktualnym statusem,
- wysyłka raportu JSON e-mailem,
- aktualizacja konfiguracji klienta Renault/Dacia z projektu społecznościowego `hacf-fr/renault-api`,
- podstawowa diagnostyka instalacji.

## Wymagania

- Node.js 18 lub nowszy,
- konto My Dacia z przypisanym pojazdem,
- opcjonalnie Gmail z weryfikacją dwuetapową i hasłem aplikacji.

## Instalacja

```bash
git clone https://github.com/TWOJ_LOGIN/dacia-data-collector.git
cd dacia-data-collector
npm ci
cp .env.example .env
```

Uzupełnij w `.env` co najmniej:

```env
DACIA_EMAIL=twoj_email@example.com
DACIA_PASSWORD=twoje_haslo
CAR_VIN=VIN_POJAZDU
COUNTRY_CODE=PL
```

Pliku `.env` nigdy nie dodawaj do repozytorium.

## Konfiguracja Renault/Dacia

Projekt zawiera zweryfikowaną konfigurację klienta w:

```text
config/renault-client.json
```

Wartości pochodzą ze społecznościowego projektu open source `hacf-fr/renault-api`. Nie jest to oficjalne repozytorium Renault ani Dacii.

Aby odświeżyć konfigurację:

```bash
npm run update-config
```

Polecenie pobiera plik `const.py`, odczytuje europejskie wartości Gigya i Kamereon, sprawdza ich format i zapisuje lokalną kopię. Aplikacja nie pobiera konfiguracji przy każdym uruchomieniu, więc awaria GitHuba nie zatrzyma działającej instalacji.

Zmienne `.env` mają pierwszeństwo i pozwalają nadpisać lokalną konfigurację:

```env
GIGYA_API_KEY=
KAMEREON_API_KEY=
GIGYA_TARGET=
KAMEREON_TARGET=
```

Zwykle należy pozostawić je puste.

## Diagnostyka

```bash
npm run doctor
```

Sprawdza obecność podstawowych zmiennych, format konfiguracji oraz dostępność endpointów. Nie wysyła hasła ani danych pojazdu do GitHuba.

Pełny test:

```bash
npm start
curl http://127.0.0.1:3000/api/status
```

## Wysyłka raportu

Uzupełnij:

```env
GMAIL_USER=twoj_email@gmail.com
GMAIL_APP_PASSWORD=haslo_aplikacji_google
REPORT_RECIPIENT=odbiorca@example.com
DACIA_APP_URL=http://127.0.0.1:3000/api/status
```

Następnie:

```bash
npm run report
```

Przykład cron codziennie o 23:59:

```cron
59 23 * * * cd /opt/dacia-data-collector && /usr/bin/node collect-and-send.js >> /var/log/dacia-report.log 2>&1
```

## Skrypty npm

| Polecenie | Działanie |
|---|---|
| `npm start` | uruchamia serwer |
| `npm run report` | wysyła jednorazowy raport |
| `npm run doctor` | sprawdza instalację |
| `npm run update-config` | odświeża konfigurację Renault/Dacia |
| `npm run check` | sprawdza składnię wszystkich plików JS |

## Bezpieczeństwo

Nie publikuj:

- `.env`,
- loginu i hasła My Dacia,
- hasła aplikacji Gmail,
- tokenów sesyjnych i JWT,
- VIN-u, `personId` i identyfikatorów kont,
- danych lokalizacji i logów produkcyjnych.

Przed publikacją uruchom:

```bash
git status --ignored
git grep -nE 'DACIA_PASSWORD|GMAIL_APP_PASSWORD|x-gigya-id_token|Bearer '
```

## Pochodzenie konfiguracji klienta

Klucze Gigya i Kamereon są identyfikatorami klienta używanymi do rozpoczęcia przepływu logowania. Nie są hasłem użytkownika ani tokenem sesji. Projekt odświeża je z aktualnej wersji społecznościowej biblioteki `hacf-fr/renault-api`. Źródło może zmienić strukturę lub przestać być utrzymywane, dlatego aktualizacja jest ręczna, walidowana i zapisywana lokalnie.

## Ograniczenia

- API jest nieoficjalne i może zmienić się bez zapowiedzi.
- Dane pojazdu mogą być opóźnione.
- Nie wszystkie modele obsługują wszystkie endpointy.
- `fuelQuantity` może nie rozróżniać benzyny i LPG.

## Licencja

MIT. Zobacz [LICENSE](LICENSE).
