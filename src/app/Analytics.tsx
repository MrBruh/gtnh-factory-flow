import Script from "next/script";

const umamiWebsiteId = process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID;
const umamiScriptUrl = process.env.NEXT_PUBLIC_UMAMI_SCRIPT_URL;
const umamiHostUrl = process.env.NEXT_PUBLIC_UMAMI_HOST_URL;

export function Analytics() {
  if (!umamiWebsiteId || !umamiScriptUrl) {
    return null;
  }

  return (
    <Script
      src={umamiScriptUrl}
      data-website-id={umamiWebsiteId}
      data-host-url={umamiHostUrl}
      strategy="afterInteractive"
      defer
    />
  );
}
