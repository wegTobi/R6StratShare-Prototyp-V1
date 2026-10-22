import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const sharp = await import(
  pathToFileURL(path.join(root, "node_modules", ".pnpm", "node_modules", "sharp", "lib", "index.js")).href
).then((module) => module.default);
const cellWidth = 600;
const cellHeight = 450;
const columns = 4;
const outputDir = path.join(root, "public", "map-previews");
const outputSheet = path.join(outputDir, "map-preview-sheet.webp");
const outputManifest = path.join(outputDir, "map-preview-sheet.json");
const layeredMapsDir = path.join(root, "public", "maps-layered-webp");

const mapAliases = {
  casino: "calypso-casino",
  club: "clubhouse",
  emerald: "emeraldplains",
  labs: "nighthavenlabs",
  stadiumalpha: "stadiuma",
};

const displayNames = {
  bartlett: "Bartlett University",
  casino: "Calypso Casino",
  club: "Club House",
  emerald: "Emerald Plains",
  labs: "Nighthaven Labs",
  stadiumalpha: "Stadium Alpha",
};

function fromPublicUrl(url) {
  return path.join(root, "public", url.replace(/^\//, ""));
}

async function readMaps() {
  const source = await fs.readFile(path.join(root, "app", "map-data.ts"), "utf8");
  const start = source.indexOf("export const tacticalMaps");
  const arrayStart = source.indexOf("[", start);
  const end = source.indexOf("];", arrayStart);

  if (start < 0 || arrayStart < 0 || end < 0) {
    throw new Error("Could not read tacticalMaps from app/map-data.ts");
  }

  const arrayLiteral = source.slice(arrayStart, end + 1);
  return Function(`"use strict"; return (${arrayLiteral});`)();
}

function toDisplayName(slug) {
  return (
    displayNames[slug] ??
    slug
      .split("-")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ")
  );
}

async function readLayeredMaps(appMaps) {
  const entries = await fs.readdir(layeredMapsDir, { withFileTypes: true });
  const mapsBySlug = new Map(appMaps.map((map) => [map.slug, map]));
  const folders = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => toDisplayName(a).localeCompare(toDisplayName(b)));

  return Promise.all(
    folders.map(async (folder) => {
      const appMap = mapsBySlug.get(mapAliases[folder] ?? folder);
      const layout = appMap ? getPreviewLayout(appMap) : { id: `${folder}-preview`, label: "1st Floor" };
      const floorImage = await getFirstFloorImage(folder);

      return {
        slug: folder,
        name: appMap?.name ?? toDisplayName(folder),
        folder,
        layout,
        baseImage: `/maps-layered-webp/${folder}/original-cache-svg.webp`,
        floorImage,
      };
    }),
  );
}

async function getFirstFloorImage(folder) {
  const floorDir = path.join(layeredMapsDir, folder, "floors");
  const files = await fs.readdir(floorDir);
  const floorFiles = files
    .map((file) => {
      const match = file.match(/_floor_(-?\d+)\.webp$/);
      return match ? { file, floor: Number(match[1]) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.floor - b.floor);
  const firstFloor = floorFiles.find((entry) => entry.floor === 1) ?? floorFiles.find((entry) => entry.floor === 0) ?? floorFiles[0];
  const fallbackFloor = files.find((file) => file.endsWith(".webp"));

  if (!firstFloor && !fallbackFloor) {
    throw new Error(`No floor webp found for ${folder}`);
  }

  return `/maps-layered-webp/${folder}/floors/${firstFloor?.file ?? fallbackFloor}`;
}

function getPreviewLayout(map) {
  return (
    map.layouts.find((layout) => layout.label.toLowerCase() === "1st floor" && layout.baseImage) ??
    map.layouts.find((layout) => layout.baseImage && layout.floorImage) ??
    map.layouts.find((layout) => layout.baseImage) ??
    map.layouts[0]
  );
}

async function layerInput(src, layout, mapName, includeFloorOffset = false) {
  const transform = layout.imageTransform ?? {};
  const scale = transform.scale ?? 1;
  const offset = includeFloorOffset ? layout.floorOffset ?? { x: 0, y: 0 } : { x: 0, y: 0 };
  const width = Math.round(cellWidth * scale);
  const height = Math.round(cellHeight * scale);
  const translateX = (transform.x ?? 0) + offset.x;
  const translateY = (transform.y ?? 0) + offset.y;
  const cropLeft = Math.max(0, Math.min(width - cellWidth, Math.round((width - cellWidth) / 2 - translateX)));
  const cropTop = Math.max(0, Math.min(height - cellHeight, Math.round((height - cellHeight) / 2 - translateY)));

  const resized = await sharp(fromPublicUrl(src)).resize(width, height, { fit: "fill" }).webp().toBuffer();
  let image = sharp(resized);

  if (width >= cellWidth && height >= cellHeight) {
    image = image.extract({ left: cropLeft, top: cropTop, width: cellWidth, height: cellHeight });
  }

  let input;

  try {
    input = await image
      .resize(cellWidth, cellHeight, { fit: "contain", background: { r: 8, g: 13, b: 16, alpha: 0 } })
      .webp()
      .toBuffer();
  } catch (error) {
    throw new Error(
      `${mapName} ${layout.label} failed for ${src} (${width}x${height}, crop ${cropLeft},${cropTop}): ${error.message}`,
    );
  }

  return { input, left: 0, top: 0 };
}

async function renderMapCell(map) {
  const layout = map.layout;
  const composites = [];

  composites.push(await layerInput(map.baseImage, layout, map.name));

  composites.push(await layerInput(map.floorImage, layout, map.name, true));

  const input = await sharp({
    create: {
      width: cellWidth,
      height: cellHeight,
      channels: 4,
      background: { r: 8, g: 13, b: 16, alpha: 1 },
    },
  })
    .composite(composites)
    .webp({ quality: 82 })
    .toBuffer();

  return {
    input,
    layoutId: layout.id,
    layoutLabel: layout.label,
  };
}

async function main() {
  const appMaps = await readMaps();
  const maps = await readLayeredMaps(appMaps);
  const rows = Math.ceil(maps.length / columns);
  const composites = [];
  const manifest = {
    cell: { width: cellWidth, height: cellHeight },
    columns,
    rows,
    maps: [],
  };

  await fs.mkdir(outputDir, { recursive: true });

  for (const [index, map] of maps.entries()) {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const cell = await renderMapCell(map);

    composites.push({
      input: cell.input,
      left: column * cellWidth,
      top: row * cellHeight,
    });

    manifest.maps.push({
      slug: map.slug,
      name: map.name,
      row,
      column,
      layoutId: cell.layoutId,
      layoutLabel: cell.layoutLabel,
    });
  }

  await sharp({
    create: {
      width: columns * cellWidth,
      height: rows * cellHeight,
      channels: 4,
      background: { r: 8, g: 13, b: 16, alpha: 1 },
    },
  })
    .composite(composites)
    .webp({ quality: 82 })
    .toFile(outputSheet);

  await fs.writeFile(outputManifest, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Created ${path.relative(root, outputSheet)} (${columns * cellWidth}x${rows * cellHeight})`);
  console.log(`Created ${path.relative(root, outputManifest)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
