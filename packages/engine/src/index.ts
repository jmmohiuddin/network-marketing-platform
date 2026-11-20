// Public surface of @nmp/engine: contracts, run(), replay(), explain() and the limit helpers.
export * from './errors.js'
export * from './money.js'
export * from './pipeline.js'
export * from './tree.js'
export type * from './types.js'
export * from './explain.js'
export * from './replay.js'
export * from './run.js'
// capPass is not exported: it updates pass 7's lines in place (TK-B6-14), which only the runner may rely on.
export { allocateCap, capAmountMinor, constraintPass, orderStructureBaseRaw } from './primitives/caps.js'
export * from './json.js'
export { checkExpression, EXPRESSION_MAX_DEPTH, EXPRESSION_MAX_NODES, expressionRefs, renderExpression, type ExprType } from './expression.js'
export * from './plan.js'
