import { loadPageData } from "../lib/page/load";
import { PageView } from "./page-view";

// Read at request time: which Tournament is next depends on today, and the build has no
// database to read from.
export const dynamic = "force-dynamic";

export default async function Home() {
  const now = new Date();
  const data = await loadPageData(now);
  return <PageView data={data} now={now} />;
}
