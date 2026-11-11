# ROYAL IT Portal - AD read-path diagnostic (read-only)
# Run this under the same Windows identity that runs node server.js / the Windows service when possible.
[CmdletBinding()]
param(
    [string]$DepartmentRootOU = $(if ($env:DEPT_PARENT_OU) { $env:DEPT_PARENT_OU } else { 'Departments' }),
    [string]$ComputerOU = 'Client_Computers'
)

$ErrorActionPreference = 'Stop'
$result = [ordered]@{
    success = $false
    timestamp = (Get-Date).ToString('o')
    windowsIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    powershellVersion = $PSVersionTable.PSVersion.ToString()
    activeDirectoryModuleAvailable = $false
    domain = $null
    domainDN = $null
    domainController = $null
    departmentRootFound = $false
    departmentRootDN = $null
    departments = @()
    totalDomainUsers = $null
    totalDomainComputers = $null
    clientComputersOUFound = $false
    clientComputersOUDN = $null
    clientComputersCount = $null
    error = $null
}

try {
    Import-Module ActiveDirectory -ErrorAction Stop
    $result.activeDirectoryModuleAvailable = [bool](Get-Module ActiveDirectory)
    $domain = Get-ADDomain -ErrorAction Stop
    $result.domain = $domain.DNSRoot
    $result.domainDN = $domain.DistinguishedName
    try { $result.domainController = (Get-ADDomainController -Discover -ErrorAction Stop).HostName } catch { $result.domainController = $null }

    $root = Get-ADOrganizationalUnit -Filter * -SearchBase $domain.DistinguishedName -SearchScope OneLevel -ErrorAction Stop |
        Where-Object { $_.Name -eq $DepartmentRootOU } | Select-Object -First 1
    if ($root) {
        $result.departmentRootFound = $true
        $result.departmentRootDN = $root.DistinguishedName
        $result.departments = @(
            Get-ADOrganizationalUnit -Filter * -SearchBase $root.DistinguishedName -SearchScope OneLevel -ErrorAction Stop |
            Sort-Object Name |
            ForEach-Object {
                $ou = $_
                $count = @(Get-ADUser -Filter * -SearchBase $ou.DistinguishedName -SearchScope Subtree -ErrorAction Stop).Count
                [PSCustomObject]@{ name = $ou.Name; distinguishedName = $ou.DistinguishedName; userCount = $count }
            }
        )
    }

    $result.totalDomainUsers = @(Get-ADUser -Filter * -SearchBase $domain.DistinguishedName -SearchScope Subtree -ErrorAction Stop).Count
    $result.totalDomainComputers = @(Get-ADComputer -Filter * -SearchBase $domain.DistinguishedName -SearchScope Subtree -ErrorAction Stop).Count

    $client = Get-ADOrganizationalUnit -Filter * -SearchBase $domain.DistinguishedName -SearchScope OneLevel -ErrorAction Stop |
        Where-Object { $_.Name -eq $ComputerOU } | Select-Object -First 1
    if ($client) {
        $result.clientComputersOUFound = $true
        $result.clientComputersOUDN = $client.DistinguishedName
        $result.clientComputersCount = @(Get-ADComputer -Filter * -SearchBase $client.DistinguishedName -SearchScope Subtree -ErrorAction Stop).Count
    } else {
        $result.clientComputersCount = 0
    }
    $result.success = $true
} catch {
    $result.error = $_.Exception.Message
}

$result | ConvertTo-Json -Depth 8
if (-not $result.success) { exit 1 }
