output "zone_id" {
  description = "Cloudflare Zone ID for togather.nyc"
  value       = data.cloudflare_zone.togather.id
}

output "zone_name" {
  description = "Zone name"
  value       = data.cloudflare_zone.togather.name
}

output "dns_records" {
  description = "Summary of managed DNS records"
  value = {
    root     = cloudflare_record.root.hostname
    staging  = cloudflare_record.staging.hostname
    wildcard = cloudflare_record.wildcard.hostname
  }
}
