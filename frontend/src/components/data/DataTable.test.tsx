import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DataTable, type DataColumn } from './DataTable'

/**
 * The duplicate-key defect, and what it actually cost.
 *
 * `PositionalReportTable` builds one column per server-supplied header over
 * a shared `cells` array, so every column was `key: 'cells'`. React logged a
 * duplicate-key error per column per render, and the financial report was
 * the loudest — ten per render.
 *
 * Found by opening the page, not by the suite: the table still *drew*
 * correctly, because the columns are rebuilt from `headers` on every render
 * and each `render` closes over its own index. So a test asserting the
 * rendered cells would have passed before the fix and proved nothing.
 *
 * What the collision genuinely broke is sorting. `DataTable` looked the
 * sorted column up by `key`, so with several columns sharing one it matched
 * the first every time and sorted by whatever that column read. These tests
 * assert that, because it is the behaviour a key collision destroys rather
 * than merely warns about.
 */
type PositionalRow = { id: number; cells: (string | number)[] }

function positionalColumns(headers: string[]): DataColumn<PositionalRow>[] {
  return headers.map((header, index) => ({
    id: `cell-${index}`,
    key: 'cells',
    sortValue: (row) => row.cells[index] ?? '',
    header,
    sortable: true,
    render: (row) => String(row.cells[index]),
  }))
}

/**
 * The two columns order the rows **differently**, on purpose.
 *
 * The first version of this fixture had names and numbers ascending
 * together, so sorting by either produced the same sequence and the test
 * passed with the defect still present. Mutating the code is what exposed
 * it. A fixture where every column agrees cannot tell you which column was
 * used.
 *
 * By name:   Alice, Bravo, Charlie  (numbers 30, 10, 20)
 * By number: Bravo(10), Charlie(20), Alice(30)
 */
const ROWS: PositionalRow[] = [
  { id: 0, cells: ['Alice', 30] },
  { id: 1, cells: ['Charlie', 20] },
  { id: 2, cells: ['Bravo', 10] },
]

const bodyColumn = (index: number) =>
  screen
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[index].textContent)

describe('DataTable with several columns over one field', () => {
  it('renders every column, with headers and cells aligned', () => {
    render(<DataTable columns={positionalColumns(['Driver', 'Trips'])} rows={ROWS} />)

    expect(screen.getAllByRole('columnheader').map((h) => h.textContent?.trim())).toEqual([
      'Driver',
      'Trips',
    ])
    expect(bodyColumn(0)).toEqual(['Alice', 'Charlie', 'Bravo'])
    expect(bodyColumn(1)).toEqual(['30', '20', '10'])
  })

  /**
   * The one that fails without `id`. Clicking the *second* header must sort
   * by the second column; matching on `key` finds the first column instead,
   * and every header then sorts the table identically.
   */
  it('sorts by the column that was clicked, not the first one sharing its key', async () => {
    render(<DataTable columns={positionalColumns(['Driver', 'Trips'])} rows={ROWS} />)

    await userEvent.click(screen.getByText('Trips'))

    // Ascending by the numeric second column: 10, 20, 30 — a sequence the
    // first column does NOT produce, which is what makes this discriminating.
    expect(bodyColumn(1)).toEqual(['10', '20', '30'])
    expect(bodyColumn(0)).toEqual(['Bravo', 'Charlie', 'Alice'])
  })

  it('marks only the clicked column as sorted', async () => {
    render(<DataTable columns={positionalColumns(['Driver', 'Trips'])} rows={ROWS} />)

    await userEvent.click(screen.getByText('Trips'))

    // The direction arrow lives in the header that owns the sort; with a
    // key collision the indicator lands on the first column instead.
    const headers = screen.getAllByRole('columnheader')
    expect(headers[1].innerHTML).toContain('arrow-up')
    expect(headers[0].innerHTML).not.toContain('arrow-up')
  })

  it('logs no duplicate-key error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(<DataTable columns={positionalColumns(['A', 'B', 'C', 'D'])} rows={ROWS} />)

    const duplicates = spy.mock.calls.filter((args) => String(args[0] ?? '').includes('same key'))
    expect(duplicates).toEqual([])

    spy.mockRestore()
  })
})

describe('DataTable with ordinary one-field-per-column tables', () => {
  type Row = { id: number; name: string; trips: number }

  const COLUMNS: DataColumn<Row>[] = [
    { key: 'name', header: 'Name', sortable: true },
    { key: 'trips', header: 'Trips', sortable: true, numeric: true },
  ]

  const rows: Row[] = [
    { id: 1, name: 'Charlie', trips: 3 },
    { id: 2, name: 'Alice', trips: 1 },
  ]

  /** `id` is optional, so every existing caller must behave exactly as before. */
  it('still sorts when no id is supplied', async () => {
    render(<DataTable columns={COLUMNS} rows={rows} />)

    await userEvent.click(screen.getByText('Name'))

    expect(bodyColumn(0)).toEqual(['Alice', 'Charlie'])
  })

  it('toggles direction on a second click', async () => {
    render(<DataTable columns={COLUMNS} rows={rows} />)

    await userEvent.click(screen.getByText('Name'))
    await userEvent.click(screen.getByText('Name'))

    expect(bodyColumn(0)).toEqual(['Charlie', 'Alice'])
  })
})
