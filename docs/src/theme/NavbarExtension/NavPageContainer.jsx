import React from "react";
import Link from '@docusaurus/Link';
import css from "./NavPageContainer.module.css";

export default function NavPageContainer() {
  return (
    <div className={css.NavPageContainer}>
      <Link to="/guides" className={css.NavPageItem}>
        Guide
      </Link>
      <Link
        to="/developer"
        className={css.NavPageItem}
      >
        Developer
      </Link>
      <Link
        to="/api-reference"
        className={css.NavPageItem}
      >
        API Reference
      </Link>
    </div>
  );
}