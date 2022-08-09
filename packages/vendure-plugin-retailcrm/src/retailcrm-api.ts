import got from 'got';

export interface RetailcrmApiOptions {
    shopName: string;
    accountName: string;
    apiKey: string;
}

export type RetailcrmApi = ReturnType<typeof initRetailcrmApi>;

type RetailcrmResponse<T extends object> =
    | {
          success: true;
          data: T;
      }
    | {
          success: false;
          errorMsg: string;
      };

function isRetailcrmResponse<T extends object>(res: unknown): res is RetailcrmResponse<T> {
    return typeof res === 'object' && res != null && 'success' in res;
}

export function initRetailcrmApi(options: RetailcrmApiOptions) {
    const gotInstance = got.extend({
        prefixUrl: `https://${options.accountName}.retailcrm.ru/api/v5/`,
        headers: {
            'X-API-KEY': options.apiKey,
        },
    });

    function api<T extends object>({
        url,
        method,
        body,
    }: {
        url: string;
        method: 'get' | 'post';
        body?: Record<string, any>;
    }): Promise<T> {
        return gotInstance(url, { method, form: body })
            .json()
            .then((res) => {
                if (isRetailcrmResponse<T>(res)) {
                    if (res.success) {
                        return res.data;
                    }
                    throw new Error(res.errorMsg);
                }
                throw new Error('Unknown Error');
            });
    }

    function getCustomerById(customerId: string): Promise<{}> {
        return api({ url: `customers/${customerId}`, method: 'get' });
    }

    function createCustomer(customer: SerializedCustomer): Promise<{}> {
        return api({ url: 'customers/create', method: 'post', body: { customer } });
    }

    function editStoreProductsBatch(products: Array<ProductEditInput>) {
        return api({ url: 'store/products/batch/edit', method: 'post', body: { products } });
    }

    function createOrder(order: SerializedOrder) {
        return api({ url: 'orders/create', method: 'post', body: { order } });
    }

    return {
        getCustomerById,
        createCustomer,
        editStoreProductsBatch,
        createOrder,
    };
}

interface SerializedCustomer {
    externalId: string;
    firstName: string;
    lastName: string;
    email: string;
    phones: CustomerPhone[];
}

interface CustomerPhone {
    number: string;
}

interface ProductEditInput {
    externalId: string;
    article: string;
    name: string;
    site: string;
}

interface SerializedOrder {
    externalId: string;
    // firstName: string;
    // lastName: string;
    customer: { externalId: string };
    items: SerializedOrderProduct[];
    delivery: SerializedOrderDelivery;
    payments: SerializedPayment[];
}

interface SerializedOrderProduct {
    externalIds: CodeValueModel[];
    productName: string;
    initialPrice: number;
    quantity: number;
    offer: {
        externalId: string;
    };
}

interface CodeValueModel {
    code: string;
    value: string;
}

interface SerializedOrderDelivery {
    code: string;
    address: OrderDeliveryAddress;
}

interface OrderDeliveryAddress {
    text: string;
    notes: string | undefined;
}

interface SerializedPayment {
    amount: number;
    type: string;
    status: string;
}
