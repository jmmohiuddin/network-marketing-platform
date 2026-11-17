'use client'

import { useState } from 'react'
import { useApi } from '../../components/api-provider'
import { Button, IconButton } from '../../components/button'
import { DataTable } from '../../components/data-table'
import { Select, TextInput } from '../../components/form-field'
import { useToast } from '../../components/toast'
import { formatDateTime } from '../../lib/format'
import { marketName, MARKETS_PATH, type Market } from '../../lib/markets'
import { useSession } from '../../lib/session'
import { useResource } from '../../lib/use-resource'
import { requiredError } from '../../lib/validation'
import { fromLocalInput } from '../admin/format'
import { FormDialog, TextAreaField } from '../admin/form-dialog'
import { tableError, usePagedList } from '../admin/resource'
import { ITEM_CLASS_LABELS, ITEM_CLASSES, MEASURE, MINOR, volumesText } from './format'
import type { VolumeRow } from './types'

const MAX_MEASURES = 20
const SKU = /^[\x21-\x7e]{1,64}$/

interface MeasureDraft {
  readonly id: number
  readonly measure: string
  readonly value: string
}

/** POST /v1/product-volumes: per-unit volumes of a SKU from valid_from (the first row of a SKU may be back-dated). */
function SetVolumesDialog({ markets, onClose, onSaved }: { readonly markets: readonly Market[]; readonly onClose: () => void; readonly onSaved: () => void }) {
  const api = useApi()
  const toast = useToast()
  const [marketId, setMarketId] = useState('')
  const [sku, setSku] = useState('')
  const [itemClass, setItemClass] = useState('product')
  const [measures, setMeasures] = useState<readonly MeasureDraft[]>([{ id: 0, measure: '', value: '' }])
  const [validFrom, setValidFrom] = useState('')
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState<Readonly<Record<string, string | null>>>({})
  const change = (id: number, field: 'measure' | 'value', value: string) =>
    setMeasures((current) => current.map((row) => (row.id === id ? { ...row, [field]: value } : row)))
  function submit(idempotencyKey: string) {
    const names = measures.map((row) => row.measure.trim())
    const found: Record<string, string | null> = {
      'vol-market': requiredError('the market', marketId),
      'vol-sku': SKU.test(sku.trim()) ? null : 'Enter the SKU (1 to 64 visible characters, no spaces).',
      'vol-valid-from': fromLocalInput(validFrom) === null ? 'Enter when the volumes apply from.' : null,
      'vol-reason': requiredError('the reason', reason),
      ...Object.fromEntries(measures.flatMap((row, index) => [
        [`vol-measure-${row.id}`, !MEASURE.test(names[index]!) ? 'Use lower-case letters, digits and _ (start with a letter).' : names.indexOf(names[index]!) !== index ? 'Each measure once.' : null],
        [`vol-value-${row.id}`, MINOR.test(row.value.trim()) ? null : 'Enter whole minor units, for example 140.'],
      ])),
    }
    setErrors(found)
    const items = Object.entries(found).flatMap(([fieldId, message]) => (message === null ? [] : [{ fieldId, message }]))
    if (items.length > 0) return { items }
    return {
      items,
      fieldIds: {
        market_id: 'vol-market', sku: 'vol-sku', valid_from: 'vol-valid-from', reason: 'vol-reason',
        ...Object.fromEntries(measures.map((row) => [`volumes.${row.measure.trim()}`, `vol-value-${row.id}`])),
      },
      send: async () => {
        const volumes = Object.fromEntries(measures.map((row) => [row.measure.trim(), row.value.trim()]))
        const body = { market_id: marketId, sku: sku.trim(), item_class: itemClass, volumes, valid_from: fromLocalInput(validFrom), reason: reason.trim() }
        await api.post('/v1/product-volumes', body, { idempotencyKey })
        toast({ message: `Volumes of ${sku.trim()} saved.` })
        onSaved()
      },
    }
  }
  return (
    <FormDialog title="Set volumes" size="lg" submitLabel="Save volumes" onClose={onClose} onSubmit={submit}>
      <p>Volumes are per unit sold, in minor units of each measure. A SKU's first row may start in the past; later rows start now or later.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-space-md">
        <Select id="vol-market" label="Market" placeholder="Choose a market" value={marketId} error={errors['vol-market']} options={markets.map((market) => ({ value: market.id, label: marketName(market) }))} onChange={(event) => setMarketId(event.target.value)} />
        <TextInput id="vol-sku" label="SKU" value={sku} error={errors['vol-sku']} onChange={(event) => setSku(event.target.value)} />
        <Select id="vol-class" label="Item class" value={itemClass} options={ITEM_CLASSES.map((value) => ({ value, label: ITEM_CLASS_LABELS[value] ?? value }))} onChange={(event) => setItemClass(event.target.value)} />
        <TextInput id="vol-valid-from" type="datetime-local" label="Valid from (your time)" value={validFrom} error={errors['vol-valid-from']} onChange={(event) => setValidFrom(event.target.value)} />
      </div>
      <fieldset className="flex flex-col gap-space-sm">
        <legend className="font-caption text-caption uppercase tracking-wider text-secondary font-medium mb-space-xs">Measures</legend>
        {measures.map((row, index) => (
          <div key={row.id} className="grid grid-cols-[1fr_1fr_auto] gap-space-sm items-end">
            <TextInput id={`vol-measure-${row.id}`} label={`Measure ${index + 1}`} value={row.measure} error={errors[`vol-measure-${row.id}`]} onChange={(event) => change(row.id, 'measure', event.target.value)} />
            <TextInput id={`vol-value-${row.id}`} label={`Per unit ${index + 1}`} inputMode="numeric" value={row.value} error={errors[`vol-value-${row.id}`]} onChange={(event) => change(row.id, 'value', event.target.value)} />
            <IconButton icon="delete" label={`Remove measure ${index + 1}`} disabled={measures.length === 1} onClick={() => setMeasures((current) => current.filter((candidate) => candidate.id !== row.id))} />
          </div>
        ))}
        {measures.length < MAX_MEASURES && (
          <Button size="sm" icon="add" className="self-start" onClick={() => setMeasures((current) => [...current, { id: Math.max(...current.map((row) => row.id)) + 1, measure: '', value: '' }])}>Add measure</Button>
        )}
      </fieldset>
      <TextAreaField id="vol-reason" label="Reason" value={reason} error={errors['vol-reason']} onChange={setReason} />
    </FormDialog>
  )
}

function VolumeTable({ marketId, sku }: { readonly marketId: string; readonly sku: string }) {
  const list = usePagedList<VolumeRow>('/v1/product-volumes', { market_id: marketId === '' ? undefined : marketId, sku: sku === '' ? undefined : sku })
  return (
    <DataTable
      caption="Product volumes"
      columns={[
        { key: 'sku', header: 'SKU', cell: (row) => <span className="font-data-mono-sm text-data-mono-sm break-all">{row.sku}</span> },
        { key: 'market', header: 'Market', cell: (row) => row.market.code },
        { key: 'class', header: 'Class', cell: (row) => ITEM_CLASS_LABELS[row.item_class] ?? row.item_class },
        { key: 'volumes', header: 'Per unit', cell: (row) => <span className="font-data-mono-sm text-data-mono-sm">{volumesText(row.volumes)}</span> },
        { key: 'from', header: 'Valid from', cell: (row) => formatDateTime(row.valid_from) },
        { key: 'to', header: 'Valid to', cell: (row) => (row.valid_to === null ? 'In force' : formatDateTime(row.valid_to)) },
        { key: 'by', header: 'Set by', cell: (row) => <div className="flex flex-col"><span>{row.created_by.display_name ?? 'Another user'}</span><span className="font-caption text-caption text-secondary break-words">{row.reason}</span></div> },
      ]}
      rows={list.rows}
      rowKey={(row) => row.id}
      loading={list.loading}
      error={tableError(list)}
      empty={{ title: 'No volumes set' }}
      pagination={list.pagination}
    />
  )
}

/** SC-31 Product volumes: rows per SKU and market, and "Set volumes" for product.manage. */
export function VolumesTab() {
  const { can, readOnly } = useSession()
  const markets = useResource<Market[]>(MARKETS_PATH)
  const [marketId, setMarketId] = useState('')
  const [skuText, setSkuText] = useState('')
  const [sku, setSku] = useState('')
  const [open, setOpen] = useState(false)
  const [round, setRound] = useState(0)
  const marketOptions = [{ value: '', label: 'All markets' }, ...(markets.data ?? []).map((market) => ({ value: market.id, label: marketName(market) }))]
  return (
    <div className="flex flex-col gap-space-md">
      <form className="flex flex-wrap items-end gap-space-sm" onSubmit={(event) => {
        event.preventDefault()
        setSku(skuText.trim())
      }}>
        <Select label="Market" value={marketId} options={marketOptions} onChange={(event) => setMarketId(event.target.value)} />
        <TextInput label="SKU" type="search" value={skuText} onChange={(event) => setSkuText(event.target.value)} />
        <Button type="submit" icon="search">Find SKU</Button>
        {!readOnly && can('product.manage') && markets.data !== null && <Button variant="primary" icon="add_circle" className="ml-auto" onClick={() => setOpen(true)}>Set volumes</Button>}
      </form>
      <VolumeTable key={`${marketId}|${sku}|${round}`} marketId={marketId} sku={sku} />
      {open && markets.data !== null && (
        <SetVolumesDialog markets={markets.data} onClose={() => setOpen(false)} onSaved={() => {
          setOpen(false)
          setRound((value) => value + 1)
        }} />
      )}
    </div>
  )
}
