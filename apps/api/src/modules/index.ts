import type { ApiModule } from '../lib/module.js'
import { audModule } from './aud/index.js'
import { cplModule } from './cpl/index.js'
import { iamModule } from './iam/index.js'
import { impModule } from './imp/index.js'
import { intModule } from './int/index.js'
import { opsModule } from './ops/index.js'
import { payModule } from './pay/index.js'
import { prvModule } from './prv/index.js'
import { supportModule } from './support/index.js'
import { tenModule } from './ten/index.js'

/**
 * Every feature module, in mount order. A new module adds itself here. CAS is not mounted in B1 (D-B1-13: no case
 * type is registered yet); tests mount it with a fixture type.
 */
export const defaultModules: readonly ApiModule[] = [
  iamModule, tenModule, payModule, audModule, supportModule, prvModule, opsModule, impModule, cplModule, intModule,
]
