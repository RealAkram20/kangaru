export interface PaginationProps {
  page?: number;
  pageCount?: number;
  /** Supply with `total` to show a "1–25 of 184" range. */
  pageSize?: number;
  total?: number;
  onPageChange?: (page: number) => void;
  style?: React.CSSProperties;
}

export declare function Pagination(props: PaginationProps): JSX.Element;
