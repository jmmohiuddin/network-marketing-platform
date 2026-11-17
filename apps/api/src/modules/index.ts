import type { ApiModule } from '../lib/module.js'
import { audModule } from './aud/index.js'
import { createCasModule, type CaseTypeDefinition } from './cas/index.js'
import { compCaseTypes, compModule } from './comp/index.js'
import { cplModule } from './cpl/index.js'
import { crmModule } from './crm/index.js'
import { genCaseTypes, genModule } from './gen/index.js'
import { iamModule } from './iam/index.js'
import { impModule } from './imp/index.js'
import { intModule } from './int/index.js'
import { opsModule } from './ops/index.js'
import { ordModule } from './ord/index.js'
import { parCaseTypes, parModule } from './par/index.js'
import { payModule } from './pay/index.js'
import { plnModule } from './pln/index.js'
import { prvModule } from './prv/index.js'
import { supportModule } from './support/index.js'
import { tenModule } from './ten/index.js'

/** Every case type the product registers with CAS (PLAN B2 2.4, B3 2.5). */
export const caseTypes: readonly CaseTypeDefinition[] = [...genCaseTypes, ...parCaseTypes, ...compCaseTypes]

/** Every feature module, in mount order. A new module adds itself here. */
export const defaultModules: readonly ApiModule[] = [
  iamModule, tenModule, payModule, audModule, supportModule, prvModule, opsModule, impModule, cplModule, intModule,
  parModule, crmModule, genModule, ordModule, plnModule, compModule, createCasModule({ types: caseTypes }),
]
