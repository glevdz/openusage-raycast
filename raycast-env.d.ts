/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {}

/** Preferences accessible in all the extension's commands */
declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Preferences accessible in the `menu-bar` command */
  export type MenuBar = ExtensionPreferences & {}
  /** Preferences accessible in the `show-usage` command */
  export type ShowUsage = ExtensionPreferences & {}
  /** Preferences accessible in the `velocity-dashboard` command */
  export type VelocityDashboard = ExtensionPreferences & {}
  /** Preferences accessible in the `estimate-project` command */
  export type EstimateProject = ExtensionPreferences & {}
}

declare namespace Arguments {
  /** Arguments passed to the `menu-bar` command */
  export type MenuBar = {}
  /** Arguments passed to the `show-usage` command */
  export type ShowUsage = {}
  /** Arguments passed to the `velocity-dashboard` command */
  export type VelocityDashboard = {}
  /** Arguments passed to the `estimate-project` command */
  export type EstimateProject = {}
}

