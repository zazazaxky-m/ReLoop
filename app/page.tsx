import type { Metadata } from "next";
import { headers } from "next/headers";
import { LandingPage } from "@/components/landing/editorial/LandingPage";
import { NONCE_HEADER } from "@/lib/security-headers";
import { absoluteUrl, SITE_DESCRIPTION, SITE_NAME } from "@/lib/site";
import "@/components/landing/editorial/landing.css";

const HOME_TITLE = `${SITE_NAME} — Bank Sampah Digital: Setor Sampah, Dapat Reward`;

export const metadata: Metadata = {
  title: { absolute: HOME_TITLE },
  description: SITE_DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    title: HOME_TITLE,
    description: SITE_DESCRIPTION,
    siteName: SITE_NAME,
    locale: "id_ID",
  },
  twitter: {
    card: "summary_large_image",
    title: HOME_TITLE,
    description: SITE_DESCRIPTION,
  },
};

function homeJsonLd() {
  const url = absoluteUrl("/");
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${url}#organization`,
        name: SITE_NAME,
        url,
        logo: absoluteUrl("/icons/icon-512.png"),
        description: SITE_DESCRIPTION,
      },
      {
        "@type": "WebSite",
        "@id": `${url}#website`,
        name: SITE_NAME,
        url,
        inLanguage: "id-ID",
        publisher: { "@id": `${url}#organization` },
      },
    ],
  };
}

export default async function Home() {
  const nonce = (await headers()).get(NONCE_HEADER) ?? undefined;
  return (
    <>
      <script
        nonce={nonce}
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(homeJsonLd()).replace(/</g, "\\u003c"),
        }}
      />
      <LandingPage />
    </>
  );
}
