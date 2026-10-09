/**
 * Operation start: records with an earlier business date are test data (labelled is_test in SQL,
 * excluded from manager statistics). Keep in sync with public.set_test_flag().
 */
export const OPERATION_START = '2026-10-12'

export const isBeforeOperation = (date: string) => date < OPERATION_START

/** Clamp the start of a statistics period to the operation start. */
export const countFrom = (date: string) => (date < OPERATION_START ? OPERATION_START : date)
