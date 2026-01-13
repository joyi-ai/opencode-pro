import { createMemo } from "solid-js"
import { useParams } from "@solidjs/router"
import { base64Decode } from "@opencode-ai/util/encode"
import MultiPanePage from "@/pages/multi-pane"

export default function Session() {
  const params = useParams()
  const directory = createMemo(() => (params.dir ? base64Decode(params.dir) : undefined))

  return <MultiPanePage initialDir={directory()} initialSession={params.id} />
}
