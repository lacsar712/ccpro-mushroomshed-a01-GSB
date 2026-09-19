import { createSignal, onMount } from 'solid-js'
import { For, Show } from 'solid-js'
import { useSearchParams } from '@solidjs/router'
import { api } from '../api/client'
import type { MistRampBatch, MistRampBatchStatus, Room } from '../types'

const statusLabels: Record<MistRampBatchStatus, string> = {
  open: '进行中',
  complete: '已完成',
  abort: '已中止',
}

const empty = {
  roomId: '',
  startHumidity: '',
  targetHumidity: '',
  notes: '',
}

export default function MistRampBatches() {
  const [searchParams] = useSearchParams()
  const initialRoom = typeof searchParams.roomId === 'string' ? searchParams.roomId : ''

  const [rows, setRows] = createSignal<MistRampBatch[]>([])
  const [rooms, setRooms] = createSignal<Room[]>([])
  const [form, setForm] = createSignal({ ...empty, roomId: initialRoom })
  const [filterRoom, setFilterRoom] = createSignal(initialRoom)
  const [error, setError] = createSignal('')

  async function load() {
    const qs = filterRoom() ? `?roomId=${filterRoom()}` : ''
    const [batches, roomList] = await Promise.all([
      api<MistRampBatch[]>(`/api/mist-ramp-batches${qs}`),
      api<Room[]>('/api/rooms'),
    ])
    setRows(batches)
    setRooms(roomList)
  }

  onMount(() => {
    load().catch((e) => setError(e.message))
  })

  function roomLabel(id: number) {
    const r = rooms().find((x) => x.id === id)
    return r ? `${r.roomCode} · ${r.species}` : `#${id}`
  }

  async function onSubmit(e: Event) {
    e.preventDefault()
    setError('')
    try {
      await api('/api/mist-ramp-batches', {
        method: 'POST',
        body: JSON.stringify({
          roomId: Number(form().roomId),
          startHumidity: Number(form().startHumidity),
          targetHumidity: Number(form().targetHumidity),
          notes: form().notes || null,
        }),
      })
      setForm({ ...empty, roomId: form().roomId })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    }
  }

  async function complete(id: number) {
    if (!confirm(`确认完成补湿批次 #${id}?将写入一条湿度等于目标值的环境记录。`)) return
    setError('')
    try {
      await api(`/api/mist-ramp-batches/${id}/complete`, { method: 'POST' })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败')
    }
  }

  async function abort(id: number) {
    const reason = prompt(`请输入补湿批次 #${id} 的中止原因(中文,必填)`)
    if (reason === null) return
    if (!reason.trim()) {
      setError('中止原因必填')
      return
    }
    setError('')
    try {
      await api(`/api/mist-ramp-batches/${id}/abort`, {
        method: 'POST',
        body: JSON.stringify({ abortReason: reason.trim() }),
      })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败')
    }
  }

  async function remove(id: number) {
    if (!confirm('确认删除该补湿批次?')) return
    try {
      await api(`/api/mist-ramp-batches/${id}`, { method: 'DELETE' })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败')
    }
  }

  return (
    <div>
      <header class="page-header">
        <h1>补湿批次</h1>
        <p class="muted">
          雾化爬坡:起始湿度 &lt; 目标湿度,幅度 ≤ 30;同室仅一条进行中;idle 室禁开,sanitize 室须填备注
        </p>
      </header>
      {error() && <div class="error">{error()}</div>}

      <form class="panel form-grid" onSubmit={onSubmit}>
        <label>
          出菇室
          <select
            value={form().roomId}
            onChange={(e) => setForm({ ...form(), roomId: e.currentTarget.value })}
            required
          >
            <option value="">选择出菇室</option>
            <For each={rooms()}>
              {(r) => (
                <option value={String(r.id)}>
                  {r.roomCode} · {r.species} · {r.status}
                </option>
              )}
            </For>
          </select>
        </label>
        <label>
          起始湿度 (%)
          <input
            type="number"
            min="1"
            max="100"
            value={form().startHumidity}
            onInput={(e) => setForm({ ...form(), startHumidity: e.currentTarget.value })}
            required
          />
        </label>
        <label>
          目标湿度 (%)
          <input
            type="number"
            min="1"
            max="100"
            value={form().targetHumidity}
            onInput={(e) => setForm({ ...form(), targetHumidity: e.currentTarget.value })}
            required
          />
        </label>
        <label>
          备注(sanitize 室必填)
          <input
            value={form().notes}
            onInput={(e) => setForm({ ...form(), notes: e.currentTarget.value })}
          />
        </label>
        <button type="submit" class="btn primary">
          开补湿批次
        </button>
      </form>

      <div class="panel">
        <label>
          按出菇室筛选
          <select
            value={filterRoom()}
            onChange={(e) => {
              setFilterRoom(e.currentTarget.value)
              setError('')
              load().catch((err) => setError(err.message))
            }}
          >
            <option value="">全部出菇室</option>
            <For each={rooms()}>
              {(r) => (
                <option value={String(r.id)}>
                  {r.roomCode} · {r.species}
                </option>
              )}
            </For>
          </select>
        </label>
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>出菇室</th>
              <th>起始 → 目标</th>
              <th>状态</th>
              <th>开启时间</th>
              <th>关闭时间</th>
              <th>中止原因</th>
              <th>备注</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <For each={rows()}>
              {(b) => (
                <tr>
                  <td>{b.id}</td>
                  <td>{roomLabel(b.roomId)}</td>
                  <td>
                    {b.startHumidity}% → {b.targetHumidity}%
                  </td>
                  <td>
                    <span class={`badge ${b.status}`}>{statusLabels[b.status]}</span>
                  </td>
                  <td>{new Date(b.openedAt).toLocaleString()}</td>
                  <td>{b.closedAt ? new Date(b.closedAt).toLocaleString() : '—'}</td>
                  <td>{b.abortReason || '—'}</td>
                  <td>{b.notes || '—'}</td>
                  <td class="row-actions">
                    <Show when={b.status === 'open'}>
                      <button type="button" class="btn ghost" onClick={() => complete(b.id)}>
                        完成
                      </button>
                      <button type="button" class="btn ghost" onClick={() => abort(b.id)}>
                        中止
                      </button>
                    </Show>
                    <button type="button" class="btn ghost" onClick={() => remove(b.id)}>
                      删除
                    </button>
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
    </div>
  )
}
