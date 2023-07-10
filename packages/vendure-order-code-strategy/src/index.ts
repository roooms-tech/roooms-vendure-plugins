import {
    type OrderCodeStrategy,
    Injector,
    Order,
    RequestContext,
    TransactionalConnection,
    InternalServerError,
    Logger,
} from '@vendure/core';
import { customAlphabet } from 'nanoid';

const nanoId = customAlphabet('0123456789', 6);

function createId(prefix = 'R') {
    return prefix + nanoId();
}

export class ShortOrderCodeStrategy implements OrderCodeStrategy {
    private connection: TransactionalConnection | undefined;
    private loggerCtx = 'ShortOrderCodeStrategy';

    init(injector: Injector) {
        this.connection = injector.get(TransactionalConnection);
    }

    async generate(ctx: RequestContext): Promise<string> {
        let code = createId();

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

                Logger.info(`Generated an already existing code '${code}'`, this.loggerCtx);

                code = createId();
            }
        }

        return code;
    }
}
