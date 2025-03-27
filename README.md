# Rooom`s Vendure plugins

## Packages releases

For versioning and publishing the package, [`changesets`](https://github.com/changesets/changesets) is used. After the implementation of all needed changes, the following command should be executed to see the changes:

```sh
pnpm changeset
```

Then:

```sh
pnpm changeset version
```

> Attention: In  Changesets [the problem with file formatting is not fixed](https://github.com/changesets/changesets/issues/396). 
> Potentially, you will need to execute `pnpm prettier`

You need to publish everything from the CI branch and main branch. New packages will be published automatically. 
