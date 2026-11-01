import { ActivationPage } from "@/pages/activation";
import { AccountPage } from "@/pages/account";
import { EventDetailPage } from "@/pages/event-detail";
import { EventsPage } from "@/pages/events";
import { ImportPage } from "@/pages/import";
import { LoginPage } from "@/pages/login";
import { NotFoundPage } from "@/pages/not-found";
import { ParticipantDetailPage } from "@/pages/participant-detail";
import { useRoute } from "@/lib/use-route";

/**
 * App shell with a deliberately tiny router.
 *
 * Path parsing lives in `lib/router.ts` and is unit tested; this component only
 * maps a route to a page. Adding a routing dependency is still not justified:
 * the SPA has a handful of static paths and no nested layouts.
 */
export default function App() {
  const route = useRoute();

  switch (route.name) {
    case "login":
      return <LoginPage />;
    case "activation":
      return <ActivationPage />;
    case "events":
      return <EventsPage route={route} />;
    case "event":
      return <EventDetailPage route={route} eventId={route.eventId} />;
    case "participant":
      return (
        <ParticipantDetailPage
          route={route}
          eventId={route.eventId}
          participantId={route.participantId}
        />
      );
    case "import":
      return <ImportPage route={route} eventId={route.eventId} />;
    case "account":
      return <AccountPage route={route} />;
    default:
      return <NotFoundPage route={route} />;
  }
}
