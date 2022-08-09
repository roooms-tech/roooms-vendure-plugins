# Rooom`s Vendure plugins

## Релизы библиотек

Для версионирования и паблиша пэкеджей используется
[`changesets`](https://github.com/changesets/changesets). После внесения
изменений в код необходимо обязательно добавить чейнджлог:

```sh
pnpm changeset
```

Перед подготовкой нового релиза надо выполнить команду:

```sh
pnpm changeset version
```

> Внимание: пока в Changesets
> [не исправлена проблема с форматированием файлов](https://github.com/changesets/changesets/issues/396)
> может понадобиться прогонять команду `pnpm prettier`

Паблиш строго из CI из main ветки, новые пэкеджи опубликуются автоматически,
если такой версии ещё нет в registry.
