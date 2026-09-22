import { loadPageData } from "../lib/page/load";
import { PageView } from "./page-view";

// Read at request time: which Tournament is next depends on today, and the build has no
// database to read from.
export const dynamic = "force-dynamic";

export default async function Home() {
  const data = await loadPageData(new Date());
  return <PageView data={data} />;
}
