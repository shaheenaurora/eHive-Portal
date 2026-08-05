import { eq } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "./connection";

/** Website Article Series — Batch 1. Real editorial content for the Insights
 *  (blog) section, seeded idempotently on boot so it publishes on deploy without
 *  a manual CMS step. Each `body` is trusted, author-written HTML. */
type Seed = { slug: string; title: string; tag: string; excerpt: string; paras: string[] };

const ARTICLES: Seed[] = [
  {
    slug: "business-plan-isnt-dead-ai",
    title: "Your Business Plan Isn't Dead Because of AI. It Was Already Dead.",
    tag: "Strategy",
    excerpt: "AI didn't kill your business model. It just removed the cover story. Here's how to tell if your business ever had real foundations — before you blame the algorithm.",
    paras: [
      "Every founder I talk to in Dubai right now has the same explanation ready: “AI changed everything, so we had to pivot.” It's become the most convenient sentence in business. It sounds forward-thinking. It sounds like you're a victim of unstoppable technological change rather than someone whose business never had a foundation to begin with.",
      "I want to be direct about this, because nobody else in this market seems willing to be: AI is not killing businesses. It's exposing which ones were never built on anything real.",
      "Think about it like an oak tree. What you see above ground — the branches, the leaves, the product, the marketing, the office on Sheikh Zayed Road — that's not what keeps a tree standing through a storm. It's the root system underneath, invisible, unglamorous, doing the actual work. In business, that root system is what I'd call your DNA: a mission people actually believe, values that show up in how you make decisions under pressure, a culture that doesn't collapse the first time revenue dips.",
      "Most businesses never had that. They had a product, a logo, and a growth story that worked as long as capital was cheap, customer acquisition was easy, and nobody was asking hard questions. AI didn't remove any of that by force. It just made the market move fast enough that businesses without real foundations ran out of runway to fake it.",
      "Here's the uncomfortable data point: research consistently shows that only around a third of employees globally feel any real connection to their company's stated purpose. That's not an AI-era problem. That's a decade-old rot that AI is simply speeding up, because now the companies that do have alignment between what they say and what they do can execute, iterate, and adapt faster than everyone else — with or without new technology.",
      "So before you write another sentence blaming “AI disruption” for your business slowing down, ask three questions instead:",
      "<strong>Would your team still believe in what you're building if the funding dried up tomorrow?</strong> If the honest answer is no, that's not an AI problem.",
      "<strong>Do your actual day-to-day decisions reflect your stated values, or do they reflect whatever protects this quarter's numbers?</strong> Misalignment here is what breaks trust internally long before it breaks revenue externally.",
      "<strong>If a competitor launched an AI tool that did 80% of what you sell, would your business still have a reason to exist?</strong> If your entire value proposition is “we do the task,” you never had a business — you had a feature. Features get automated. Businesses with real DNA get stronger, because they were never selling the task. They were selling judgment, trust, and outcomes the task alone can't deliver.",
      "The founders who are actually thriving through this period aren't the ones who reacted fastest to AI. They're the ones who had something worth protecting before AI ever showed up — and used the disruption as a forcing function to strengthen it, not an excuse to abandon it.",
      "If you're not sure whether your business has real foundations or just a good story, that's precisely the audit we run in a Clarity Sprint — a fast, honest look at what's actually holding your business up, before you spend another dirham chasing the next trend.",
    ],
  },
  {
    slug: "free-zones-license-not-a-business",
    title: "Free Zones Are Selling You a License, Not a Business. Here's the Difference.",
    tag: "Business Setup",
    excerpt: "Dubai makes it easy to register a company. Nobody tells you that a trade license and a real business are two completely different things. Here's what actually determines which one you end up with.",
    paras: [
      "You can set up a company in the UAE in a matter of days. A trade license, a flexi-desk, a bank account if you're lucky and patient — and suddenly you're a “founder.” The UAE has built one of the most efficient company-formation machines on earth, and I say that as someone whose own firm operates inside that machine.",
      "But I need to say something that isn't good for anyone's marketing, including mine: a trade license is not a business. It's paperwork that makes a business <em>legal</em>. Whether it becomes <em>real</em> has nothing to do with how fast you got it.",
      "I watch this mistake constantly. Someone gets excited about how easy setup is, treats the ease as a signal that the hard part is done, and then spends the next eighteen months discovering that the actual business — the part that survives a slow quarter, a copycat competitor, or a market shift — was never built. The free zone gave them a start line and let them believe it was the finish line.",
      "Here's the distinction that matters: a license proves you're allowed to operate. A business proves you can survive operating. Those require completely different things.",
      "A license needs your passport, some capital, and a form. A business that survives needs what I'd call crisis-proofing built in from day one — not as an afterthought once something goes wrong. That means: decision-making that doesn't require you personally in the room for every call, because if the business only runs when you're physically present, you don't have a business, you have a job you invented for yourself. It means open, honest communication systems internally, so that when conditions get harder — and in this market, they will — your team isn't finding out from rumors. It means having actually thought through your “in the event of X, we do Y” scenarios before X happens, not during it.",
      "Marriott didn't survive the collapse in travel demand after 9/11 because their hotels were well-built. They survived because leadership had built a culture of transparency and local decision-making empowerment <em>before</em> the crisis hit — so when it did, the business could adapt in real time instead of waiting for instructions that were too slow to matter.",
      "Nobody sells you that as part of your free zone package. Nobody puts “actual business resilience” on the price list next to the trade license fee, because it's not a form you fill out once. It's infrastructure you build deliberately, and most founders don't build it until they're forced to — usually during the crisis it was supposed to prevent.",
      "If you're currently mid-setup, or you set up six months ago and are starting to feel the gap between “I have a license” and “I have a business,” that gap is exactly what a Strategy Sprint or a GapNavigator engagement is built to close — before the market forces the question on you.",
    ],
  },
  {
    slug: "financial-resilience-founders",
    title: "Being Broke and Looking Rich Are the Same Risk.",
    tag: "Finance",
    excerpt: "In a market built on visible wealth, the businesses that survive downturns are rarely the ones that look the richest. Here's what actually protects a founder when the market turns.",
    paras: [
      "This is a hard one to write, because this city runs partly on the appearance of success. The car, the office, the event you were seen at — in a market built on trust and image, looking successful is part of how you win the next deal. I understand it. I've played that game too.",
      "But here's what I need founders to actually sit with: looking financially strong and being financially resilient are not the same thing, and confusing the two is one of the most common ways a business dies quietly before it dies publicly.",
      "Financial resilience isn't about how much money is coming in. It's about how much runway you have before an income disruption forces a decision you didn't choose on your own terms. A business bringing in a healthy monthly revenue with zero buffer is, structurally, in a weaker position than a smaller business with three months of operating costs sitting untouched. One of those businesses can absorb a bad quarter. The other has to react to it in public, in real time, usually by making decisions — a rushed hire cut, a broken promise to a client, a scramble for a bridge loan — that damage the thing it was trying to protect.",
      "There's a reason the buffer matters more than the headline number: research on small business cash flow consistently shows that the businesses with more cash-buffer days survive disruptions that kill their thinner-margined competitors — not because they're more talented, but because they simply have more time to make a good decision instead of a fast one.",
      "The uncomfortable truth is that visible wealth and financial resilience often trade off against each other. Every dirham spent maintaining an image of success is a dirham that isn't sitting in a buffer, isn't diversified, isn't quietly compounding your actual staying power. That's not a moral judgment — spend how you want. It's a structural warning: if your business's survival depends on nobody ever asking to see the buffer, you don't have resilience, you have a performance.",
      "What I'd ask every founder to do this month, honestly: If your primary income source disappeared tomorrow, how many months could you operate before you're forced into a decision you'd regret? If you don't know the number, that's the actual problem — not the market, not the competition, not “cash flow being tight this quarter.” It's the absence of a number you've never forced yourself to calculate.",
      "Resilience isn't glamorous. It doesn't photograph well. But it's the only thing standing between a bad quarter and a business that no longer exists.",
    ],
  },
  {
    slug: "ai-jobs-wrong-fear",
    title: "Everyone's Terrified of AI Taking Jobs. Wrong Fear, Wrong Timeline.",
    tag: "AI & Work",
    excerpt: "The AI job-loss panic is aimed at the wrong risk. Here's what the actual 2026 data shows about who's losing ground right now — and it isn't who most people think.",
    paras: [
      "Every second conversation I have right now eventually gets to the same anxious question: “Is AI going to take my job / my team's jobs / my industry?” It's the wrong question, aimed at the wrong timeline, and answering it wrong is costing people more than the thing they're actually afraid of.",
      "Let's deal with the actual data first, because the panic and the numbers don't match. The World Economic Forum's Future of Jobs research projects roughly 92 million roles displaced by AI and automation by 2030 — alongside about 170 million new roles created in the same window. Net positive, globally, on paper. But net positive doesn't mean <em>your</em> job is safe, because the people losing roles are rarely the same people filling the new ones. That gap — not the headline number — is where the real risk lives.",
      "Here's the sharper, more current signal: Stanford's 2026 AI Index found that employment for young software developers, ages 22 to 25, has fallen nearly 20% since 2024 — while employment for developers over 30 kept growing. Same industry, same disruption, opposite outcomes, based entirely on who had already built judgment and experience AI can't yet replicate, versus who was still doing the junior tasks AI now does faster.",
      "Jamie Dimon said the quiet part out loud at JPMorgan's investor meeting earlier this year: “We have displaced people from AI — and we offer them other jobs.” Underneath JPMorgan's flat overall headcount, operations and support roles shrank while client-facing, revenue-generating roles grew. That's not mass unemployment. That's a structural rebalancing — and it's already happening inside large institutions, quietly, without headline layoffs.",
      "So here's the reframe I'd actually offer, because the fear so many founders and professionals are carrying is pointed at the wrong target. The risk was never “AI will do my job.” The risk is “I never developed the judgment, taste, and decision-quality that sits on top of the task” — because that's the layer AI still can't touch, and it's the layer that determines whether disruption threatens you or promotes you.",
      "Practically, that means: stop measuring your relevance by how many tasks you can execute, and start measuring it by how many decisions you're trusted to make. Stop treating AI literacy as optional continuing education and start treating it as the baseline — the way basic computer literacy became non-negotiable twenty years ago. And if you lead a team, the uncomfortable job in front of you isn't deciding who to automate. It's deciding, honestly, who on your team is building judgment right now versus who is still just executing tasks that are already on the clock.",
      "The businesses and careers that come out of this period stronger won't be the ones that feared AI the most. They'll be the ones that got honest, early, about which parts of their value were tasks — and which parts were judgment.",
    ],
  },
  {
    slug: "uae-golden-visa-2026-signal",
    title: "UAE's Golden Visa Reforms Are a Preparation Test, Not a Perk.",
    tag: "UAE Market",
    excerpt: "Most people read the 2026 Golden Visa changes as a convenience upgrade. Read them as a signal instead — and you'll see what the UAE is actually telling you to prepare for next.",
    paras: [
      "Most people read the 2026 Golden Visa updates as a simple upgrade — new categories, new thresholds, easier access for the right profile. That's the surface reading, and it's not wrong. But it's incomplete, and reading it only that way means you miss what the reform is actually telling you.",
      "Here's what changed, factually. The property investment threshold for a Golden Visa rose to AED 2 million for completed units, with tighter rules on off-plan eligibility. At the same time, the UAE opened new dedicated categories for AI specialists, climate-tech entrepreneurs, and cultural and creative professionals — fields that barely had a formal pathway a few years ago. On the entrepreneur side specifically, there are now distinct routes: roughly AED 1 million for an SME-style venture, or as low as AED 500,000 for a recognized innovative project, alongside a higher bar for founders who've already sold a business. Family sponsorship rules were also clarified, extending some of the same 10-year alignment to dependents.",
      "Read individually, these look like unrelated bureaucratic tweaks. Read together, they're a pattern — and it's the same pattern the UAE has run before: tighten wherever the previous system was being gamed, and open wherever the country has decided it needs talent it doesn't yet have enough of.",
      "That's not a criticism. It's useful information, if you know how to read it. A government publicly signaling “we are building formal pathways for AI specialists and climate-tech founders” is not neutral news — it's a forward-looking statement about which sectors this country is betting on attracting and retaining talent in. If you're building a business, that's a genuine leading indicator: capital, policy attention, and eventually infrastructure tend to follow these formal category creations, not the other way around.",
      "This is exactly the kind of signal the founders I respect most are trained to catch early — not reacting to policy after it's fully priced into the market, but scanning for what a policy shift implies is coming next. The Golden Visa reform isn't really about who gets a 10-year residency. It's about where the UAE is quietly telling the market to look.",
      "So the actual question isn't “do I qualify for the new thresholds.” It's: if the UAE is building formal doors for AI and climate-tech talent now, what does that tell you about where competition, capital, and opportunity are heading in your sector over the next 24 months — and are you positioning your business to be inside that wave, or reading about it after everyone else already moved?",
      "Preparation was never about meeting today's requirements. It's about noticing what today's requirements imply about tomorrow.",
    ],
  },
];

/** Insert any Batch-1 article that isn't already present (idempotent by slug). */
export async function seedInsights(): Promise<number> {
  const db = getDb();
  let added = 0;
  for (const a of ARTICLES) {
    const exists = (await db.select({ id: schema.insights.id }).from(schema.insights).where(eq(schema.insights.slug, a.slug)).limit(1)).at(0);
    if (exists) continue;
    const body = a.paras.map((p) => `<p>${p}</p>`).join("\n");
    await db.insert(schema.insights).values({ title: a.title, slug: a.slug, excerpt: a.excerpt, tag: a.tag, body, publishedAt: new Date() });
    added++;
  }
  return added;
}
