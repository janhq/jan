import React from "react";
import clsx from "clsx";
import ErrorBoundary from "@docusaurus/ErrorBoundary";
import {
  PageMetadata,
  SkipToContentFallbackId,
  ThemeClassNames,
} from "@docusaurus/theme-common";
import { useKeyboardNavigation } from "@docusaurus/theme-common/internal";
import SkipToContent from "@theme/SkipToContent";
import AnnouncementBar from "@theme/AnnouncementBar";
import Navbar from "@theme/Navbar";
import Footer from "@site/src/containers/Footer";
import LayoutProvider from "@theme/Layout/Provider";
import ErrorPageContent from "@theme/ErrorPageContent";
import styles from "./styles.module.scss";
import NavBarExtension from "../NavbarExtension";
import { useLocation } from "react-router-dom";

const allowedPaths = ["/docs/", "/developer/", "/api-reference/", "/guides/", "/guides", "/docs", "/developer", "/api-reference", "/changelog"];  

export default function Layout(props) {
  const {
    children,
    noFooter,
    wrapperClassName,
    // Not really layout-related, but kept for convenience/retro-compatibility
    title,
    description,
  } = props;
  useKeyboardNavigation();

  const location = useLocation();

  const isAllowedPath = allowedPaths.some(path => location.pathname.startsWith(path));

  return (
    <LayoutProvider>
      <PageMetadata title={title} description={description} />

      <SkipToContent />

      <AnnouncementBar />

      <Navbar/>

      {isAllowedPath ? <NavBarExtension /> : ""}

      {/* {console.log("Is allowed path?", location.pathname)} */}


      <div
        id={SkipToContentFallbackId}
        className={clsx(
          ThemeClassNames.wrapper.main,
          styles.mainWrapper,
          wrapperClassName,
          isAllowedPath && "mt-0 md:mt-11"
        )}
      >
        <ErrorBoundary fallback={(params) => <ErrorPageContent {...params} />}>
          {children}
        </ErrorBoundary>
      </div>

      {!noFooter && <Footer />}
    </LayoutProvider>
  );
}
