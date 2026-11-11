# IT Infrastructure Monitoring & Security

This repository contains sanitized example configuration templates for monitoring a Windows Server with Zabbix Agent and Wazuh Agent.

## Templates

- `ossec.conf.example` — Wazuh Agent example. Replace `WAZUH_MANAGER_IP_OR_FQDN` and `YOUR_WINDOWS_HOSTNAME` before use.
- `zabbix_agentd.conf.example` — Zabbix Agent example. Replace `ZABBIX_SERVER_IP` and `YOUR_WINDOWS_HOSTNAME` before use.

These are templates, not live server configuration exports. Keep credentials, enrollment keys, private certificates, internal addresses, domain names, and production hostnames out of public repositories.
