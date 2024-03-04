import React from "react";
import css from "./index.module.css";
import NavPageContainer from "./NavPageContainer";



export default function NavBar() {
  return (
    <div className={css.NavBar}>
      <NavPageContainer />
    </div>
  );
}