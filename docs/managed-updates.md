# Managed in-app updates

Outflow's browser update control is a request interface, not a command-execution interface. It is available only on the managed `/opt/outflow` deployment.

## Security boundary

The unprivileged `outflow` web process may:

- query fixed GitHub repository metadata;
- resolve and display a full 40-character commit SHA;
- verify that exact commit through the fixed GitHub API;
- atomically publish `/var/lib/outflow-update/request/request.json` only after its complete contents have been written behind an exclusive request guard; and
- read sanitized state from `/var/lib/outflow-update/state/state.json`.

It cannot invoke a shell, select a repository, provide filesystem paths, run arbitrary commands, or write the root-owned status directory. The request contains only the initiating user ID, installed commit, requested commit, timestamp, and the `requested` state.

The updater control root `/var/lib/outflow-update` is root-owned and separate from application-owned SQLite storage. Its request child grants the `outflow` group only the access needed to publish known request names; its state child is root-written and group-readable. The web process therefore cannot replace the state directory or forge a successful result.

`outflow-update.path` watches the fixed request path. It starts the root-owned `outflow-update.service`, which invokes the fixed `scripts/update-agent.sh` entry point through Debian's `/usr/bin/bash`. The agent accepts no HTTP-supplied command or path, rejects stale, linked, permissive, malformed, or non-regular request files, holds a non-blocking update lock, and invokes only:

```text
/opt/outflow/app/scripts/deploy-update.sh <validated-full-SHA>
```

The deployment script retains responsibility for the verified SQLite backup, staging, dependency installation, validation, atomic symlink switch, graceful systemd restart, readiness checks, and matching release/database rollback. Browser responses never contain its shell output, paths, backup names, or database details.

## State lifecycle

Persistent sanitized states are `requested`, `in_progress`, `succeeded`, `failed`, and `rolled_back`. The request and its exclusive guard remain present for the whole operation, preventing duplicate requests across administrators and application restarts. Requests expire after 15 minutes if the privileged service has not consumed them, so an old spool entry cannot unexpectedly deploy after a later reboot. The browser polls `/api/update/status`, reconnects after restart, and reports success only after the deployment script has passed `/api/ready`.

Security audit metadata is limited to the initiating user ID and current/requested commits. Credentials, request bodies, database content, backup content, and financial data are never logged.

## Bootstrap and recovery

Fresh managed installations enable the path unit during setup. An existing managed installation must bootstrap it once, after deploying a release that contains the agent, with `sudo bash /opt/outflow/app/scripts/install-update-agent.sh`. Normal updates never rewrite their own privileged systemd unit from staged release code. If the agent is unavailable or a request guard is left without a complete request after a web-process crash, the API fails safely without starting an update; inspect `journalctl -u outflow-update`, verify no update service is active, and remove only the stale request guard before retrying. The documented pinned operator updater remains available.

Legacy `/opt/fintrack` + PM2 installations are detected and rejected. The browser never stops PM2, moves data, creates a managed database, or converts deployment layout.

## systemd profiles and Proxmox LXC

Setup selects a systemd profile with `systemd-detect-virt --container`, with `/run/systemd/container` and the standard `container` environment marker as LXC fallbacks. A detected `lxc` or `lxc-libvirt` environment uses the `lxc` profile consistently for both `outflow.service` and `outflow-update.service`; all other environments use the `standard` profile. A root operator may set `OUTFLOW_SYSTEMD_PROFILE=standard` or `OUTFLOW_SYSTEMD_PROFILE=lxc` only when automatic detection must be overridden for a diagnosed host.

The standard profile retains `PrivateTmp`, `PrivateDevices`, `ProtectSystem`, `ProtectHome`, kernel/control-group protection, and fixed `ReadWritePaths`. Those directives require systemd to construct a mount namespace. Some unprivileged Proxmox LXC configurations reject that operation with `226/NAMESPACE`, so the LXC profile omits only those namespace-dependent directives.

The LXC profile still runs the application as `outflow:outflow`, keeps the update agent as a separate fixed-path root service, applies `UMask=0077`, `NoNewPrivileges`, `LockPersonality`, and `RestrictSUIDSGID`, and relies on restrictive ownership rather than a service mount namespace. Release trees are explicitly owned by `root:outflow`, directories and executable assets are group-traversable, ordinary assets are group-readable, and application code is not group-writable. SQLite data remains outside the release tree under `/var/lib/outflow`.

The service installers write only their base unit files. They do not remove or rewrite operator-created `outflow.service.d` or `outflow-update.service.d` drop-ins. An existing managed LXC installation can install the corrected base units with `sudo bash /opt/outflow/app/scripts/install-outflow-service.sh` and `sudo bash /opt/outflow/app/scripts/install-update-agent.sh`. A temporary drop-in that only disabled the incompatible namespace directives may then be removed once `systemctl cat outflow outflow-update` confirms `OutflowSystemdProfile=lxc`; run `sudo systemctl daemon-reload`, restart `outflow`, and verify both health endpoints before removing the operator backup of the drop-in.
