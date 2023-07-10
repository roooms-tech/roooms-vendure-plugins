import {
    type OrderCodeStrategy,
    Injector,
    Order,
    RequestContext,
    TransactionalConnection,
    InternalServerError,
} from '@vendure/core';
import { customAlphabet } from 'nanoid';

const nanoId = customAlphabet('0123456789', 6);

function createId(prefix = 'R') {
    return prefix + nanoId();
}

export class ShortOrderCodeStrategy implements OrderCodeStrategy {
    private connection: TransactionalConnection | undefined;

    init(injector: Injector) {
        this.connection = injector.get(TransactionalConnection);

        console.log('init', this.connection);
    }

    async generate(ctx: RequestContext): Promise<string> {
        let code = createId();

        console.log('generate', this.connection);

        if (this.connection) {
            for (let i = 0; i++; ) {
                // Max loop reached
                if (i >= 25) {
                    throw new InternalServerError("Couldn't generate a valid order code");
                }

                const orderExists = await this.connection
                    .getRepository(ctx, Order)
                    .count({ where: { code } });
                if (orderExists === 0) {
                    break;
                }
                code = createId();
            }
        }

        return code;
    }
}
