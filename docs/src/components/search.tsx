'use client'
import {
  SearchDialog,
  SearchDialogClose,
  SearchDialogContent,
  SearchDialogHeader,
  SearchDialogIcon,
  SearchDialogInput,
  SearchDialogList,
  SearchDialogOverlay,
  type SharedProps,
} from 'fumadocs-ui/components/dialog/search'
import { useStaticSearch } from 'fumadocs-core/search/client'

// Orama index is pre-built at build time (/api/search) and loaded in the
// browser, so search works on the static export.
export default function JanSearchDialog(props: SharedProps) {
  const search = useStaticSearch({})

  return (
    <SearchDialog {...search} {...props}>
      <SearchDialogOverlay />
      <SearchDialogContent>
        <SearchDialogHeader>
          <SearchDialogIcon />
          <SearchDialogInput placeholder="Search docs…" />
          <SearchDialogClose />
        </SearchDialogHeader>
        <SearchDialogList />
      </SearchDialogContent>
    </SearchDialog>
  )
}
