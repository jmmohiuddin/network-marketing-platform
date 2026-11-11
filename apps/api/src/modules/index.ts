import type { ApiModule } from '../lib/module.js'
import { audModule } from './aud/index.js'
import { cplModule } from './cpl/index.js'
import { iamModule } from './iam/index.js'
import { impModule } from './imp/index.js'
import { opsModule } from './ops/index.js'
import { prvModule } from './prv/index.js'
import { supportModule } from './support/index.js'
import { tenModule } from './ten/index.js'

/** Every feature module, in mount order. A new module adds itself here. */
export const defaultModules: readonly ApiModule[] = [iamModule, tenModule, audModule, supportModule, prvModule, opsModule, impModule, cplModule]
