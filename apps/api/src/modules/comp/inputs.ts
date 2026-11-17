import type { Tx } from '@nmp/db'
import { inputsHash, type RunInput, type RunSettings, type Snapshot } from '@nmp/engine'
import { loadPeriod, runSettings } from './period.js'
import { planFor, readSnapshot } from './snapshot.js'

export interface StoredRun {
  readonly id: string
  readonly period_id: string
  readonly plan_version_id: string
  readonly settings_version_id: string
  readonly snapshot_id: string | null
  readonly inputs_hash: string | null
}

/** The engine RunSettings of a settings version (§0.1). */
export async function engineSettings(tx: Tx, versionId: string): Promise<RunSettings> {
  const settings = await runSettings(tx, versionId)
  return {
    settingsVersionId: versionId,
    roundingMode: settings.roundingMode,
    restockingFeeAffectsVolume: settings.restockingFeeAffectsVolume,
  }
}

/** The RunInput of a run from its stored snapshot (replay, trace expansion, late adjustments of its period). */
export async function storedInput(tx: Tx, run: StoredRun, snapshot?: Snapshot): Promise<RunInput> {
  if (run.snapshot_id === null) throw new Error(`run ${run.id} has no snapshot`)
  const period = await loadPeriod(tx, run.period_id)
  return {
    plan: await planFor(tx, run.plan_version_id, period.calendar_id, period.starts_us),
    settings: await engineSettings(tx, run.settings_version_id),
    snapshot: snapshot ?? (await readSnapshot(tx, run.snapshot_id)),
  }
}

export class InputsDiffer extends Error {
  constructor(readonly runId: string) {
    super(`the stored input of run ${runId} no longer hashes to its inputs_hash`)
  }
}

/** A committed run's input, verified against its inputs_hash (D-B3-13 "verify inputs_hash"). */
export async function committedInput(tx: Tx, runId: string): Promise<RunInput> {
  const { rows } = await tx.query<StoredRun>(
    'SELECT id, period_id, plan_version_id, settings_version_id, snapshot_id, inputs_hash FROM run WHERE id = $1',
    [runId],
  )
  const input = await storedInput(tx, rows[0]!)
  if (inputsHash(input) !== rows[0]!.inputs_hash) throw new InputsDiffer(runId)
  return input
}
