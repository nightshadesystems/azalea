// Hand-written mirror of the serde structs in src/azalea-common/src/types.rs
// and the ad-hoc JSON in src/azalea-webd/src/api.rs. Change both together.

export type Role = 'admin' | 'operator';

/** GET /api/session, POST /api/login */
export interface Session {
  username: string;
  role: Role;
  admin: boolean;
}

/** GET /api/identity (unauthenticated) */
export interface Identity {
  hostname: string;
  azalea_version: string;
}

/** GET /api/system */
export interface SystemInfo {
  hostname: string;
  version: string;
  release_train: string;
  built_on: string;
  architecture: string;
  boot_via: string;
  system_type: string;
  hardware_vendor: string;
  hardware_model: string;
  azalea_version: string;
}

export interface LoadAverage {
  one: number;
  five: number;
  fifteen: number;
}

/** Bytes. */
export interface Memory {
  total: number;
  used: number;
  free: number;
  buffers: number;
  cached: number;
}

/** Bytes. */
export interface Disk {
  mount: string;
  filesystem: string;
  total: number;
  used: number;
  available: number;
}

export interface InterfaceSummary {
  total: number;
  up: number;
  down: number;
  admin_down: number;
}

/** GET /api/system/status */
export interface SystemStatus {
  uptime_secs: number;
  load: LoadAverage;
  memory: Memory;
  disks: Disk[];
  interfaces: InterfaceSummary;
}

/** GET /api/system/tls */
export interface TlsInfo {
  fingerprint: string | null;
}

export type InterfaceKind =
  | 'ethernet'
  | 'vlan'
  | 'bridge'
  | 'bonding'
  | 'tunnel'
  | 'wireguard'
  | 'loopback'
  | 'dummy'
  | 'other';

export interface InterfaceCounters {
  rx_bytes: number;
  tx_bytes: number;
  rx_packets: number;
  tx_packets: number;
  rx_errors: number;
  tx_errors: number;
  rx_dropped: number;
  tx_dropped: number;
}

/** One row of GET /api/interfaces */
export interface Interface {
  name: string;
  kind: InterfaceKind;
  admin_up: boolean;
  oper_up: boolean;
  description: string;
  mtu: number;
  mac: string;
  addresses: string[];
  parent: string | null;
  vlan_id: number | null;
  members: string[];
  counters: InterfaceCounters;
}

/** One /api/stream frame entry */
export interface CounterSample {
  name: string;
  oper_up: boolean;
  counters: InterfaceCounters;
}

/** One /api/stream WebSocket message */
export interface StreamFrame {
  /** Unix time, milliseconds. */
  t: number;
  samples: CounterSample[];
}

/** GET /api/interfaces/<name> */
export interface InterfaceDetail {
  name: string;
  kind: InterfaceKind;
  fields: [string, string][];
  raw: string;
}
