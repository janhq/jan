import React from "react";
import { NavLink, useLocation } from "react-router-dom";

export default function NavBarExtension() {
  const location = useLocation();

  return (
    <nav className="bg-white dark:bg-gray-800 h-12 px-10 pt-3 flex items-center justify-between fixed top-14 left-0 w-full z-50 hidden md:block">
      <div className="flex items-center space-x-16">
        <NavLink
          to="/docs"
          className="text-gray-700 font-medium hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-200"
          activeClassName="text-gray-900 dark:text-gray-100 font-bold border-b-2 border-gray-900 dark:border-gray-100"
        >
          Docs
        </NavLink>
        <NavLink
          to="/guides"
          className="text-gray-700 font-medium hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-200"
          activeClassName="text-gray-900 dark:text-gray-100 font-bold border-b-2 border-gray-900 dark:border-gray-100"
        >
          Guides
        </NavLink>
        <NavLink
          to="/developer"
          className="text-gray-700 font-medium hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-200"
          activeClassName="text-gray-900 dark:text-gray-100 font-semibold border-b-2 border-gray-900 dark:border-gray-100"
        >
          Developer
        </NavLink>
        <NavLink
          to="/api-reference"
          className="text-gray-700 font-medium hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-200"
          activeClassName="text-gray-900 dark:text-gray-100 font-semibold border-b-2 border-gray-900 dark:border-gray-100"
        >
          API Reference
        </NavLink>
        <NavLink
          to="/changelog"
          className="text-gray-700 font-medium hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-200"
          activeClassName="text-gray-900 dark:text-gray-100 font-bold border-b-2 border-gray-900 dark:border-gray-100"
        >
          Changelog 
        </NavLink>
      </div>
    </nav>
  );
}
