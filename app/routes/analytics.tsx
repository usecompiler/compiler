import { Link, useLoaderData, redirect } from "react-router";
import type { Route } from "./+types/analytics";
import { requireActiveAuth } from "~/lib/auth.server";
import { canManageOrganization } from "~/lib/permissions.server";
import { getOrganizationAnalytics, type DailyStats } from "~/lib/analytics.server";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend,
} from "chart.js";
import { Line } from "react-chartjs-2";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend
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

  const stats = await getOrganizationAnalytics(
    user.organization.id,
    user.organization.createdAt,
    timezone
  );

  return { stats };
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

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function ConversationChart({ data }: { data: DailyStats[] }) {
  const chartData = {
    labels: data.map((d) => formatDate(d.date)),
    datasets: [
      {
        label: "Conversations",
        data: data.map((d) => d.conversationCount),
        borderColor: "#3b82f6",
        backgroundColor: "rgba(59, 130, 246, 0.1)",
        fill: true,
        tension: 0.3,
        pointRadius: 0,
        pointHoverRadius: 4,
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
        bodyColor: "#3b82f6",
        padding: 12,
        cornerRadius: 8,
      },
    },
    scales: {
      x: {
        grid: {
          display: false,
        },
        ticks: {
          color: "#a3a3a3",
          font: { size: 11 },
          maxTicksLimit: 8,
        },
        border: {
          display: false,
        },
      },
      y: {
        beginAtZero: true,
        grid: {
          color: "rgba(82, 82, 82, 0.3)",
        },
        ticks: {
          color: "#a3a3a3",
          font: { size: 11 },
          precision: 0,
        },
        border: {
          display: false,
        },
      },
    },
  };

  return (
    <section>
      <h2 className="text-sm font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-4">
        Conversations
      </h2>
      <div className="bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-lg p-6">
        <div style={{ height: "300px" }}>
          <Line data={chartData} options={options} />
        </div>
      </div>
    </section>
  );
}

function MessageChart({ data }: { data: DailyStats[] }) {
  const chartData = {
    labels: data.map((d) => formatDate(d.date)),
    datasets: [
      {
        label: "Messages",
        data: data.map((d) => d.messageCount),
        borderColor: "#10b981",
        backgroundColor: "rgba(16, 185, 129, 0.1)",
        fill: true,
        tension: 0.3,
        pointRadius: 0,
        pointHoverRadius: 4,
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
        bodyColor: "#10b981",
        padding: 12,
        cornerRadius: 8,
      },
    },
    scales: {
      x: {
        grid: {
          display: false,
        },
        ticks: {
          color: "#a3a3a3",
          font: { size: 11 },
          maxTicksLimit: 8,
        },
        border: {
          display: false,
        },
      },
      y: {
        beginAtZero: true,
        grid: {
          color: "rgba(82, 82, 82, 0.3)",
        },
        ticks: {
          color: "#a3a3a3",
          font: { size: 11 },
          precision: 0,
        },
        border: {
          display: false,
        },
      },
    },
  };

  return (
    <section>
      <h2 className="text-sm font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-4">
        Messages
      </h2>
      <div className="bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-lg p-6">
        <div style={{ height: "300px" }}>
          <Line data={chartData} options={options} />
        </div>
      </div>
    </section>
  );
}

function DailyActiveUsersChart({ data }: { data: DailyStats[] }) {
  const chartData = {
    labels: data.map((d) => formatDate(d.date)),
    datasets: [
      {
        label: "Active Users",
        data: data.map((d) => d.activeUserCount),
        borderColor: "#8b5cf6",
        backgroundColor: "rgba(139, 92, 246, 0.1)",
        fill: true,
        tension: 0.3,
        pointRadius: 0,
        pointHoverRadius: 4,
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
        bodyColor: "#8b5cf6",
        padding: 12,
        cornerRadius: 8,
      },
    },
    scales: {
      x: {
        grid: {
          display: false,
        },
        ticks: {
          color: "#a3a3a3",
          font: { size: 11 },
          maxTicksLimit: 8,
        },
        border: {
          display: false,
        },
      },
      y: {
        beginAtZero: true,
        grid: {
          color: "rgba(82, 82, 82, 0.3)",
        },
        ticks: {
          color: "#a3a3a3",
          font: { size: 11 },
          precision: 0,
        },
        border: {
          display: false,
        },
      },
    },
  };

  return (
    <section>
      <h2 className="text-sm font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-4">
        Daily Active Users
      </h2>
      <div className="bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-lg p-6">
        <div style={{ height: "300px" }}>
          <Line data={chartData} options={options} />
        </div>
      </div>
    </section>
  );
}

function formatTokenCount(tokens: number): string {
  if (tokens >= 1000000) {
    return `${(tokens / 1000000).toFixed(1)}M`;
  }
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}K`;
  }
  return tokens.toString();
}

function TokenUsageChart({ data }: { data: DailyStats[] }) {
  const chartData = {
    labels: data.map((d) => formatDate(d.date)),
    datasets: [
      {
        label: "Tokens",
        data: data.map((d) => d.tokenCount),
        borderColor: "#f59e0b",
        backgroundColor: "rgba(245, 158, 11, 0.1)",
        fill: true,
        tension: 0.3,
        pointRadius: 0,
        pointHoverRadius: 4,
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
        bodyColor: "#f59e0b",
        padding: 12,
        cornerRadius: 8,
        callbacks: {
          label: (context: { parsed: { y: number | null } }) => {
            return `Tokens: ${(context.parsed.y ?? 0).toLocaleString()}`;
          },
        },
      },
    },
    scales: {
      x: {
        grid: {
          display: false,
        },
        ticks: {
          color: "#a3a3a3",
          font: { size: 11 },
          maxTicksLimit: 8,
        },
        border: {
          display: false,
        },
      },
      y: {
        beginAtZero: true,
        grid: {
          color: "rgba(82, 82, 82, 0.3)",
        },
        ticks: {
          color: "#a3a3a3",
          font: { size: 11 },
          callback: (value: number | string) => formatTokenCount(Number(value)),
        },
        border: {
          display: false,
        },
      },
    },
  };

  return (
    <section>
      <h2 className="text-sm font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-4">
        Token Usage
      </h2>
      <div className="bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-lg p-6">
        <div style={{ height: "300px" }}>
          <Line data={chartData} options={options} />
        </div>
      </div>
    </section>
  );
}

function ShareChart({ data }: { data: DailyStats[] }) {
  const chartData = {
    labels: data.map((d) => formatDate(d.date)),
    datasets: [
      {
        label: "Shares",
        data: data.map((d) => d.shareCount),
        borderColor: "#ec4899",
        backgroundColor: "rgba(236, 72, 153, 0.1)",
        fill: true,
        tension: 0.3,
        pointRadius: 0,
        pointHoverRadius: 4,
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
        bodyColor: "#ec4899",
        padding: 12,
        cornerRadius: 8,
      },
    },
    scales: {
      x: {
        grid: {
          display: false,
        },
        ticks: {
          color: "#a3a3a3",
          font: { size: 11 },
          maxTicksLimit: 8,
        },
        border: {
          display: false,
        },
      },
      y: {
        beginAtZero: true,
        grid: {
          color: "rgba(82, 82, 82, 0.3)",
        },
        ticks: {
          color: "#a3a3a3",
          font: { size: 11 },
          precision: 0,
        },
        border: {
          display: false,
        },
      },
    },
  };

  return (
    <section>
      <h2 className="text-sm font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-4">
        Conversation Shares
      </h2>
      <div className="bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-lg p-6">
        <div style={{ height: "300px" }}>
          <Line data={chartData} options={options} />
        </div>
      </div>
    </section>
  );
}

export default function Analytics() {
  const { stats } = useLoaderData<typeof loader>();

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-900">
      <header className="border-b border-neutral-200 dark:border-neutral-800">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center gap-4">
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

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-8">
        <DailyActiveUsersChart data={stats} />
        <ConversationChart data={stats} />
        <MessageChart data={stats} />
        <ShareChart data={stats} />
        <TokenUsageChart data={stats} />
      </main>
    </div>
  );
}
