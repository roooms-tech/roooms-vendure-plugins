# Vendure RetailCRM plugin

## Configuration

Configure in `vendure-config.ts`.

```js
import { RetailCRMPlugin } from '@roooms-tech/vendure-plugin-retailcrm';

plugins: [
    RetailCRMPlugin.init({
        accountName: '<account-name>',
        apiKey: '<api-key>',
    }),
];
```
