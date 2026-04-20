"use client";
// SiteMap — Google Maps full-screen view with colour-coded markers per status.
// Requires NEXT_PUBLIC_GOOGLE_MAPS_API_KEY to be set.
// Falls back gracefully to an info message if the key is absent.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { MapPin, Map as MapIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { cn } from "@/lib/utils";
import type { SiteStatus, MediaType } from "@/lib/types/database";

// ─── Types ────────────────────────────────────────────────────────────────────

interface MapSite {
  id: string;
  name: string;
  site_code: string;
  media_type: MediaType;
  status: SiteStatus;
  city: string;
  latitude: number | null;
  longitude: number | null;
  base_rate_paise: number | null;
}

interface Props {
  sites: MapSite[];
  apiKey: string;
}

// Marker colour per status
const STATUS_MARKER_COLORS: Record<SiteStatus, string> = {
  available: "#10b981",   // emerald-500
  booked: "#3b82f6",      // blue-500
  maintenance: "#f59e0b", // amber-500
  blocked: "#94a3b8",     // slate-400
  expired: "#ef4444",     // red-500
};

// ─── Component ────────────────────────────────────────────────────────────────

export function SiteMap({ sites, apiKey }: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapType, setMapType] = useState<"roadmap" | "satellite">("roadmap");
  const [selectedSite, setSelectedSite] = useState<MapSite | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");

  const googleMapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);

  // Sites that have valid GPS coordinates
  const geoSites = sites.filter((s) => s.latitude && s.longitude);
  const filteredSites = geoSites.filter((s) => {
    if (statusFilter && s.status !== statusFilter) return false;
    if (typeFilter && s.media_type !== typeFilter) return false;
    return true;
  });

  // Load Google Maps JS API
  useEffect(() => {
    // If Maps is already loaded (e.g. hot reload), mark loaded without setting state during the effect body
    if (typeof window === "undefined") return;
    if ((window as unknown as {google?: unknown}).google) {
      // Use a microtask so setState is not called synchronously during the effect
      Promise.resolve().then(() => setMapLoaded(true));
      return;
    }

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=marker`;
    script.async = true;
    script.defer = true;
    script.onload = () => setMapLoaded(true);
    document.head.appendChild(script);

    return () => {
      document.head.removeChild(script);
    };
  }, [apiKey]);

  // Initialise map after script loads
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;

    const map = new google.maps.Map(mapRef.current, {
      zoom: 10,
      center: { lat: 19.076, lng: 72.877 }, // Mumbai default
      mapTypeId: mapType,
      disableDefaultUI: false,
      zoomControl: true,
      streetViewControl: false,
      fullscreenControl: false,
    });

    googleMapRef.current = map;
  }, [mapLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-draw markers when filter/data changes
  useEffect(() => {
    if (!googleMapRef.current) return;

    // Clear existing markers
    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];

    // Add new markers
    const bounds = new google.maps.LatLngBounds();
    let hasBounds = false;

    filteredSites.forEach((site) => {
      if (!site.latitude || !site.longitude) return;

      const position = { lat: site.latitude, lng: site.longitude };
      const color = STATUS_MARKER_COLORS[site.status] ?? "#94a3b8";

      const marker = new google.maps.Marker({
        position,
        map: googleMapRef.current!,
        title: site.name,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 10,
          fillColor: color,
          fillOpacity: 0.9,
          strokeColor: "#ffffff",
          strokeWeight: 2,
        },
      });

      marker.addListener("click", () => {
        setSelectedSite(site);
      });

      markersRef.current.push(marker);
      bounds.extend(position);
      hasBounds = true;
    });

    if (hasBounds && filteredSites.length > 1) {
      googleMapRef.current.fitBounds(bounds);
    } else if (hasBounds && filteredSites.length === 1) {
      googleMapRef.current.setCenter(bounds.getCenter());
      googleMapRef.current.setZoom(14);
    }
  }, [filteredSites, mapLoaded]);

  // Toggle map type
  useEffect(() => {
    if (!googleMapRef.current) return;
    googleMapRef.current.setMapTypeId(mapType);
  }, [mapType]);

  const sitesWithoutGPS = sites.length - geoSites.length;

  return (
    <div className="relative h-[calc(100vh-9rem)] flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-4 p-3 bg-white border-b border-border flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-8 rounded border border-border px-2 text-sm bg-white"
          >
            <option value="">All Statuses</option>
            <option value="available">Available</option>
            <option value="booked">Booked</option>
            <option value="maintenance">Maintenance</option>
            <option value="blocked">Blocked</option>
            <option value="expired">Expired</option>
          </select>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="h-8 rounded border border-border px-2 text-sm bg-white"
          >
            <option value="">All Types</option>
            <option value="billboard">Billboard</option>
            <option value="hoarding">Hoarding</option>
            <option value="dooh">DOOH</option>
            <option value="kiosk">Kiosk</option>
            <option value="wall_wrap">Wall Wrap</option>
            <option value="unipole">Unipole</option>
            <option value="bus_shelter">Bus Shelter</option>
            <option value="custom">Custom</option>
          </select>
          <span className="text-xs text-muted-foreground">
            {filteredSites.length} site{filteredSites.length !== 1 ? "s" : ""} shown
            {sitesWithoutGPS > 0 && ` · ${sitesWithoutGPS} without GPS`}
          </span>
        </div>

        {/* Map type toggle */}
        <div className="flex rounded-md border border-border overflow-hidden">
          <button
            onClick={() => setMapType("roadmap")}
            className={cn(
              "px-3 py-1.5 text-xs flex items-center gap-1",
              mapType === "roadmap"
                ? "bg-blue-600 text-white"
                : "bg-white text-muted-foreground hover:bg-muted"
            )}
          >
            <MapIcon className="h-3.5 w-3.5" />
            Map
          </button>
          <button
            onClick={() => setMapType("satellite")}
            className={cn(
              "px-3 py-1.5 text-xs flex items-center gap-1",
              mapType === "satellite"
                ? "bg-blue-600 text-white"
                : "bg-white text-muted-foreground hover:bg-muted"
            )}
          >
            <MapPin className="h-3.5 w-3.5" />
            Satellite
          </button>
        </div>
      </div>

      {/* Status legend */}
      <div className="flex items-center gap-3 px-3 py-1.5 bg-white border-b border-border text-xs text-muted-foreground flex-wrap">
        {Object.entries(STATUS_MARKER_COLORS).map(([status, color]) => (
          <span key={status} className="flex items-center gap-1">
            <span
              className="h-2.5 w-2.5 rounded-full border border-white shadow-sm"
              style={{ backgroundColor: color }}
            />
            <span className="capitalize">{status}</span>
          </span>
        ))}
      </div>

      {/* Map container */}
      <div ref={mapRef} className="flex-1" />

      {/* Site info popup */}
      {selectedSite && (
        <div className="absolute bottom-6 left-4 right-4 sm:left-auto sm:right-6 sm:w-72 bg-white rounded-xl shadow-lg border border-border p-4">
          <button
            onClick={() => setSelectedSite(null)}
            className="absolute top-3 right-3 text-muted-foreground hover:text-foreground text-lg leading-none"
          >
            ×
          </button>
          <p className="font-semibold text-foreground pr-6">{selectedSite.name}</p>
          <p className="text-xs font-mono text-muted-foreground mt-0.5">{selectedSite.site_code}</p>
          <div className="mt-2 flex items-center gap-2">
            <StatusBadge status={selectedSite.status} />
            <span className="text-xs text-muted-foreground capitalize">
              {selectedSite.media_type.replace(/_/g, " ")}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">{selectedSite.city}</p>
          {selectedSite.base_rate_paise && (
            <p className="text-sm font-medium text-foreground mt-1">
              {new Intl.NumberFormat("en-IN", {
                style: "currency",
                currency: "INR",
                maximumFractionDigits: 0,
              }).format(selectedSite.base_rate_paise / 100)}
              <span className="text-xs font-normal text-muted-foreground">/mo</span>
            </p>
          )}
          <div className="flex gap-2 mt-3">
            <Link href={`/sites/${selectedSite.id}`} className="flex-1">
              <Button variant="outline" size="sm" className="w-full text-xs">
                View Details
              </Button>
            </Link>
            <Link href={`/sites/${selectedSite.id}/edit`}>
              <Button variant="ghost" size="sm" className="text-xs">
                Edit
              </Button>
            </Link>
          </div>
        </div>
      )}

      {/* Empty state: no sites with GPS */}
      {geoSites.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted/90">
          <div className="text-center px-8">
            <MapPin className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="font-medium text-foreground">No sites with GPS coordinates</p>
            <p className="text-sm text-muted-foreground mt-1">
              Add latitude and longitude when creating or editing a site to see it here.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
