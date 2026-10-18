# Privacy

[Polski poniżej](#prywatność)

This policy covers the shopping list at https://shopping-list.val.run/.

## What is stored

There are no accounts. The app does not ask for your name, email or phone number.

For each list the database keeps:

- the random list id that is part of the link,
- the list name and the items: their names, order, whether they are ticked off or deleted,
- for every change, a timestamp and a random id of the browser tab that made it
  (the id is new every time the page is opened),
- the time the list was last used.

Removing an item only marks it as deleted, so its name stays in the database until the whole
list is deleted.

## Who can see it

Anyone who has the link can read and edit the list. Share it only with people you shop with.

I don't use the data for anything other than showing the list to people who have the link.
There is no analytics, no advertising, and the app sets no cookies of its own.

## How long it is kept

A list that nobody opens for 14 days expires. It is deleted with all its items the next time
the app cleans up: when someone opens the expired link, when anyone creates a new list, and at
random during normal use.

## Hosting

The app runs on [Val Town](https://www.val.town/). Requests to it pass through Val Town's
infrastructure, which may keep technical logs and set its own security cookie, under Val Town's
policies.

## Contact

Questions or a request to delete a list: open an issue at
https://github.com/michaljonik/shopping-list/issues. Changes to this policy are visible in the
repository history.

---

# Prywatność

Ta polityka dotyczy listy zakupów pod adresem https://shopping-list.val.run/.

## Co jest zapisywane

Nie ma kont. Aplikacja nie pyta o imię, adres e-mail ani numer telefonu.

Dla każdej listy baza przechowuje:

- losowy identyfikator listy, który jest częścią linku,
- nazwę listy i pozycje: ich nazwy, kolejność oraz to, czy są odhaczone lub usunięte,
- przy każdej zmianie znacznik czasu i losowy identyfikator karty przeglądarki, z której
  przyszła (identyfikator jest nowy przy każdym otwarciu strony),
- czas ostatniego użycia listy.

Usunięcie pozycji tylko oznacza ją jako usuniętą, więc jej nazwa zostaje w bazie do czasu
usunięcia całej listy.

## Kto to widzi

Każdy, kto ma link, może czytać i edytować listę. Wysyłaj go tylko osobom, z którymi robisz
zakupy.

Nie używam tych danych do niczego poza pokazaniem listy osobom, które mają link. Nie ma
analityki ani reklam, a aplikacja nie ustawia własnych ciasteczek.

## Jak długo dane są przechowywane

Lista, której nikt nie otworzy przez 14 dni, wygasa. Zostaje usunięta razem z pozycjami przy
najbliższym sprzątaniu: gdy ktoś otworzy wygasły link, gdy ktokolwiek założy nową listę,
a także losowo w trakcie zwykłego używania.

## Hosting

Aplikacja działa na [Val Town](https://www.val.town/). Zapytania przechodzą przez
infrastrukturę Val Town, która może przechowywać logi techniczne i ustawiać własne ciasteczko
bezpieczeństwa, zgodnie z zasadami Val Town.

## Kontakt

Pytania albo prośba o usunięcie listy: zgłoszenie (issue) na
https://github.com/michaljonik/shopping-list/issues. Zmiany tej polityki widać w historii
repozytorium.
