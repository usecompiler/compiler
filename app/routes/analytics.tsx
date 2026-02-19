import { Link, useLoaderData, redirect } from "react-router";
import type { Route } from "./+types/analytics";
import { requireActiveAuth } from "~/lib/auth.server";
import { canManageOrganization } from "~/lib/permissions.server";
import { getOrganizationAnalytics, type DailyStats, type AnalyticsSummary } from "~/lib/analytics.server";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
} from "chart.js";
import { Line } from "react-chartjs-2";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip
);

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireActiveAuth(request);

  if (!canManageOrganization(user.membership?.role)) {
    throw redirect("/");
  }

  if (!user.organization) {
    throw redirect("/");
  }

  const url = new URL(request.url);
  const timezone = url.searchParams.get("tz") || "UTC";

  const analytics = await getOrganizationAnalytics(
    user.organization.id,
    user.organization.createdAt,
    timezone
  );

  return analytics;
}

export async function clientLoader({ request, serverLoader }: Route.ClientLoaderArgs) {
  const url = new URL(request.url);

  if (!url.searchParams.has("tz")) {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    url.searchParams.set("tz", timezone);
    throw redirect(url.pathname + url.search);
  }

  return serverLoader();
}

clientLoader.hydrate = true;

function formatNumber(value: number): string {
  if (value >= 1000000) {
    return `${(value / 1000000).toFixed(1)}M`;
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}K`;
  }
  if (!Number.isInteger(value)) {
    return value.toFixed(1);
  }
  return value.toLocaleString();
}

interface DashboardCardProps {
  title: string;
  total: number;
  period: string;
  data: DailyStats[];
  dataKey: keyof DailyStats;
  color: string;
  showTotal?: boolean;
}

function DashboardCard({ title, total, period, data, dataKey, color, showTotal }: DashboardCardProps) {
  const sumTotal = data.reduce((acc, d) => acc + (d[dataKey] as number), 0);
  const chartData = {
    labels: data.map((d) => d.date),
    datasets: [
      {
        data: data.map((d) => d[dataKey] as number),
        borderColor: color,
        backgroundColor: `${color}1a`,
        fill: true,
        tension: 0.3,
        pointRadius: 0,
        borderWidth: 2,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: "index" as const,
      intersect: false,
    },
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        backgroundColor: "#262626",
        borderColor: "#404040",
        borderWidth: 1,
        titleColor: "#a3a3a3",
        bodyColor: color,
        padding: 8,
        cornerRadius: 6,
        displayColors: false,
        callbacks: {
          title: (items: { label: string }[]) => {
            const dateStr = items[0]?.label;
            if (!dateStr) return "";
            const date = new Date(dateStr + "T00:00:00");
            return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
          },
          label: (context: { parsed: { y: number | null } }) => {
            return formatNumber(context.parsed.y ?? 0);
          },
        },
      },
    },
    scales: {
      x: {
        display: false,
      },
      y: {
        display: false,
        beginAtZero: true,
      },
    },
  };

  return (
    <div>
      <h3 className="text-sm font-medium text-neutral-500 dark:text-neutral-400 mb-2 px-1">{title}</h3>
      <div className="bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl p-5">
        <div className="flex items-baseline gap-2 mb-4">
          <span className="text-3xl font-semibold text-neutral-900 dark:text-neutral-100">
            {formatNumber(total)}
          </span>
          <span className="text-xs text-neutral-400 dark:text-neutral-500">{period}</span>
          {showTotal && (
            <span className="ml-auto text-xs text-neutral-400 dark:text-neutral-500">
              {formatNumber(sumTotal)} total
            </span>
          )}
        </div>
        <div style={{ height: "80px" }}>
          <Line data={chartData} options={options} />
        </div>
      </div>
    </div>
  );
}

export default function Analytics() {
  const { stats, totals } = useLoaderData<typeof loader>() as AnalyticsSummary;

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-900">
      <header className="border-b border-neutral-200 dark:border-neutral-800">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center gap-4">
          <Link
            to="/"
            className="p-2 -ml-2 text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
            </svg>
          </Link>
          <h1 className="text-lg font-medium text-neutral-900 dark:text-neutral-100">Analytics</h1>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <DashboardCard
            title="Daily Active Users"
            total={totals.dau}
            period="today"
            data={stats}
            dataKey="activeUserCount"
            color="#8b5cf6"
          />
          <DashboardCard
            title="Weekly Active Users"
            total={totals.wau}
            period="this week"
            data={stats}
            dataKey="wauCount"
            color="#6366f1"
          />
          <DashboardCard
            title="Monthly Active Users"
            total={totals.mau}
            period="this month"
            data={stats}
            dataKey="mauCount"
            color="#a855f7"
          />
          <DashboardCard
            title="Conversations"
            total={totals.conversations}
            period="today"
            data={stats}
            dataKey="conversationCount"
            color="#3b82f6"
            showTotal
          />
          <DashboardCard
            title="Messages"
            total={totals.messages}
            period="today"
            data={stats}
            dataKey="messageCount"
            color="#10b981"
            showTotal
          />
          <DashboardCard
            title="Avg Messages per User"
            total={totals.avgMessagesPerUser}
            period="today"
            data={stats}
            dataKey="avgMessagesPerUser"
            color="#0ea5e9"
          />
          <DashboardCard
            title="Shares"
            total={totals.shares}
            period="today"
            data={stats}
            dataKey="shareCount"
            color="#ec4899"
            showTotal
          />
          <DashboardCard
            title="Token Usage"
            total={totals.tokens}
            period="today"
            data={stats}
            dataKey="tokenCount"
            color="#f59e0b"
            showTotal
          />
        </div>
      </main>
    </div>
  );
}
