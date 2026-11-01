import type { ReactNode } from "react";

import { AppLayout } from "@/components/app-layout";
import { useRoute } from "@/lib/use-route";
import type { AppRoute } from "@/lib/router";
import { ActivationPage } from "@/pages/activation";
import { AccountPage } from "@/pages/account";
import { ActivityPage } from "@/pages/activity";
import { DashboardPage } from "@/pages/dashboard";
import { EventLabelsPage } from "@/pages/event-labels";
import { EventWorkspacePage } from "@/pages/event-workspace";
import { EventsPage } from "@/pages/events";
import { HomeRedirectPage } from "@/pages/home-redirect";
import { ImportPage } from "@/pages/import";
import { LoginPage } from "@/pages/login";
import { NotFoundPage } from "@/pages/not-found";
import { ParticipantDetailPage } from "@/pages/participant-detail";
import { RegisterPage } from "@/pages/register";
import { StaffHistoryPage, StaffHomePage, StaffScanPage } from "@/pages/staff";

/**
 * App shell with a deliberately tiny router.
 *
 * Path parsing lives in `lib/router.ts` and is unit tested; this component only
 * maps a route to a page and decides which screens sit outside the global
 * navigation frame (login, activation, and the role-resolving root redirect).
 */
export default function App() {
  const route = useRoute();

  switch (route.name) {
    case "home":
      return <HomeRedirectPage />;
    case "login":
      return <LoginPage />;
    case "register":
      return <RegisterPage />;
    case "activation":
      return <ActivationPage />;
    default:
      return <AppLayout route={route}>{renderPage(route)}</AppLayout>;
  }
}

function renderPage(route: AppRoute): ReactNode {
  switch (route.name) {
    case "dashboard":
      return <DashboardPage />;
    case "events":
      return <EventsPage />;
    case "event":
      return <EventWorkspacePage eventId={route.eventId} tab={route.tab} />;
    case "participant":
      return (
        <ParticipantDetailPage eventId={route.eventId} participantId={route.participantId} />
      );
    case "import":
      return <ImportPage eventId={route.eventId} />;
    case "labels":
      return <EventLabelsPage eventId={route.eventId} />;
    case "activity":
      return <ActivityPage />;
    case "settings":
      return <AccountPage title="Pengaturan" subtitle="Profil dan keanggotaan acara" />;
    case "staffHome":
      return <StaffHomePage />;
    case "staffScan":
      return <StaffScanPage />;
    case "staffHistory":
      return <StaffHistoryPage />;
    case "staffProfile":
      return <AccountPage title="Profil" subtitle="Sesi dan keanggotaan acara" />;
    default:
      return <NotFoundPage />;
  }
}
