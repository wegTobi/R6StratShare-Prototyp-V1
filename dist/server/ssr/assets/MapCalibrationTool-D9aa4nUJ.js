import { i as parseMapCalibration, n as getCalibrationFactors, r as getReferenceLength } from "./map-calibration-data-0NPCBSsa.js";
import { useEffect, useRef, useState } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
var MapCalibrationTool_module_default = {
	tool: "_tool_12s3n_1",
	header: "_header_12s3n_2",
	kicker: "_kicker_12s3n_5",
	instructions: "_instructions_12s3n_6",
	controls: "_controls_12s3n_7",
	workspace: "_workspace_12s3n_11",
	mapFrame: "_mapFrame_12s3n_13",
	artwork: "_artwork_12s3n_14",
	floor: "_floor_12s3n_15",
	base: "_base_12s3n_16",
	drawing: "_drawing_12s3n_17",
	endpoint: "_endpoint_12s3n_19",
	actions: "_actions_12s3n_20",
	primary: "_primary_12s3n_25",
	status: "_status_12s3n_26",
	results: "_results_12s3n_27",
	upload: "_upload_12s3n_35"
};
//#endregion
//#region app/MapCalibrationTool.tsx
var storageKey = "r6-stratshare-map-calibration-v1";
var emptyCalibration = {
	version: 1,
	referenceLabel: "Hatch edge",
	referenceMapSlug: "",
	measurements: {}
};
function MapCalibrationTool({ maps }) {
	const [calibration, setCalibration] = useState(emptyCalibration);
	const [mapSlug, setMapSlug] = useState(maps[0].slug);
	const [layoutId, setLayoutId] = useState(maps[0].layouts[0].id);
	const [points, setPoints] = useState([]);
	const [dimensions, setDimensions] = useState(null);
	const [zoom, setZoom] = useState(100);
	const [status, setStatus] = useState("");
	const imageRef = useRef(null);
	const selectedMap = maps.find((map) => map.slug === mapSlug) ?? maps[0];
	const layout = selectedMap.layouts.find((item) => item.id === layoutId) ?? selectedMap.layouts[0];
	const image = layout.floorImage ?? layout.image;
	const saved = calibration.measurements[mapSlug];
	const completed = maps.filter((map) => calibration.measurements[map.slug]);
	const factors = getCalibrationFactors(calibration);
	const measurement = dimensions && points.length === 2 ? {
		layoutId: layout.id,
		image,
		imageWidth: dimensions.width,
		imageHeight: dimensions.height,
		points: [points[0], points[1]]
	} : null;
	const canSave = measurement && getReferenceLength(measurement) * measurement.imageWidth >= 4;
	useEffect(() => {
		const currentImage = imageRef.current;
		if (currentImage?.complete && currentImage.naturalWidth > 0) setDimensions({
			width: currentImage.naturalWidth,
			height: currentImage.naturalHeight
		});
	}, [image]);
	useEffect(() => {
		try {
			const stored = localStorage.getItem(storageKey);
			if (stored) setCalibration(parseMapCalibration(JSON.parse(stored)));
		} catch {
			setStatus("Saved measurements could not be read. You can load a calibration JSON backup.");
		}
	}, []);
	function persist(next) {
		setCalibration(next);
		try {
			localStorage.setItem(storageKey, JSON.stringify(next));
			setStatus("Saved locally. Export JSON when you finish to keep a portable backup.");
		} catch {
			setStatus("Browser storage is unavailable. Export JSON before leaving this page.");
		}
	}
	function chooseMap(slug) {
		const map = maps.find((item) => item.slug === slug);
		const existing = calibration.measurements[slug];
		const nextLayoutId = map.layouts.find((item) => item.id === existing?.layoutId)?.id ?? map.layouts[0].id;
		setMapSlug(slug);
		setLayoutId(nextLayoutId);
		setPoints(existing?.points ?? []);
		if (slug !== mapSlug || nextLayoutId !== layout.id) setDimensions(null);
		setZoom(100);
		setStatus("");
	}
	function markPoint(event) {
		const rect = imageRef.current?.getBoundingClientRect();
		if (!dimensions || !rect?.width || !rect.height) return;
		const point = {
			x: (event.clientX - rect.left) / rect.width,
			y: (event.clientY - rect.top) / rect.height
		};
		if (point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) return;
		setPoints((current) => current.length === 2 ? [point] : [...current, point]);
		setStatus("");
	}
	function saveMeasurement(nextMap = false) {
		if (!measurement || !canSave) return;
		persist({
			...calibration,
			referenceMapSlug: calibration.referenceMapSlug || mapSlug,
			measurements: {
				...calibration.measurements,
				[mapSlug]: measurement
			}
		});
		if (nextMap) {
			const remaining = maps.find((map) => map.slug !== mapSlug && !calibration.measurements[map.slug]);
			if (remaining) chooseMap(remaining.slug);
		}
	}
	function exportJson() {
		const text = JSON.stringify({
			...calibration,
			scaleFactors: getCalibrationFactors(calibration)
		}, null, 2);
		const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
		const link = document.createElement("a");
		link.href = url;
		link.download = "r6-map-calibration.json";
		link.click();
		URL.revokeObjectURL(url);
	}
	async function loadJson(file) {
		try {
			const imported = parseMapCalibration(JSON.parse(await file.text()));
			for (const [slug, record] of Object.entries(imported.measurements)) {
				const floor = maps.find((item) => item.slug === slug)?.layouts.find((item) => item.id === record.layoutId);
				if (!floor || record.image !== (floor.floorImage ?? floor.image)) throw new Error("The file contains an unknown map or floor image.");
			}
			persist(imported);
			setPoints([]);
		} catch (error) {
			setStatus(error instanceof Error ? error.message : "Could not load calibration JSON.");
		}
	}
	return /* @__PURE__ */ jsxs("main", {
		className: MapCalibrationTool_module_default.tool,
		children: [
			/* @__PURE__ */ jsxs("header", {
				className: MapCalibrationTool_module_default.header,
				children: [/* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("span", {
					className: MapCalibrationTool_module_default.kicker,
					children: "One-time setup"
				}), /* @__PURE__ */ jsx("h1", { children: "Map scale calibration" })] }), /* @__PURE__ */ jsx("a", {
					href: "/",
					children: "Back to StratShare"
				})]
			}),
			/* @__PURE__ */ jsx("p", {
				className: MapCalibrationTool_module_default.instructions,
				children: "On each map, choose a floor and click both ends of the same in-game distance, such as one hatch edge. Use the same kind of reference on every map. Zoom in for precision; it does not affect the measurement."
			}),
			/* @__PURE__ */ jsx("p", {
				className: MapCalibrationTool_module_default.instructions,
				children: "Measurements are saved in this browser. Export the JSON to have the measured scales added permanently to the project. This tool does not change existing strats or the editor zoom yet."
			}),
			/* @__PURE__ */ jsxs("div", {
				className: MapCalibrationTool_module_default.controls,
				children: [
					/* @__PURE__ */ jsxs("label", { children: ["Map", /* @__PURE__ */ jsx("select", {
						value: mapSlug,
						onChange: (event) => chooseMap(event.target.value),
						children: maps.map((map) => /* @__PURE__ */ jsxs("option", {
							value: map.slug,
							children: [map.name, calibration.measurements[map.slug] ? " — measured" : ""]
						}, map.slug))
					})] }),
					/* @__PURE__ */ jsxs("label", { children: ["Floor", /* @__PURE__ */ jsx("select", {
						value: layout.id,
						onChange: (event) => {
							setLayoutId(event.target.value);
							setPoints([]);
							setDimensions(null);
						},
						children: selectedMap.layouts.map((floor) => /* @__PURE__ */ jsx("option", {
							value: floor.id,
							children: floor.label
						}, floor.id))
					})] }),
					/* @__PURE__ */ jsxs("label", { children: ["Reference", /* @__PURE__ */ jsx("input", {
						value: calibration.referenceLabel,
						onChange: (event) => persist({
							...calibration,
							referenceLabel: event.target.value
						}),
						placeholder: "Hatch edge"
					})] }),
					/* @__PURE__ */ jsxs("label", { children: [
						"Zoom: ",
						zoom,
						"%",
						/* @__PURE__ */ jsx("input", {
							"aria-label": "Calibration zoom",
							type: "range",
							min: 100,
							max: 400,
							step: 25,
							value: zoom,
							onChange: (event) => setZoom(Number(event.target.value))
						})
					] })
				]
			}),
			/* @__PURE__ */ jsxs("div", {
				className: MapCalibrationTool_module_default.workspace,
				children: [/* @__PURE__ */ jsxs("section", { children: [
					/* @__PURE__ */ jsx("div", {
						className: MapCalibrationTool_module_default.mapFrame,
						children: /* @__PURE__ */ jsxs("div", {
							className: MapCalibrationTool_module_default.artwork,
							onClick: markPoint,
							style: { width: `${zoom}%` },
							children: [
								layout.baseImage ? /* @__PURE__ */ jsx("img", {
									className: MapCalibrationTool_module_default.base,
									src: layout.baseImage,
									alt: "",
									"aria-hidden": "true",
									draggable: false
								}) : null,
								/* @__PURE__ */ jsx("img", {
									ref: imageRef,
									className: MapCalibrationTool_module_default.floor,
									src: image,
									alt: `${selectedMap.name} ${layout.label} reference measurement`,
									draggable: false,
									onLoad: (event) => setDimensions({
										width: event.currentTarget.naturalWidth,
										height: event.currentTarget.naturalHeight
									}),
									onError: () => {
										setDimensions(null);
										setStatus("The floor image could not be loaded. Choose another floor.");
									}
								}, image),
								/* @__PURE__ */ jsx("svg", {
									className: MapCalibrationTool_module_default.drawing,
									viewBox: "0 0 100 100",
									preserveAspectRatio: "none",
									"aria-hidden": "true",
									children: points.length === 2 ? /* @__PURE__ */ jsx("line", {
										x1: points[0].x * 100,
										y1: points[0].y * 100,
										x2: points[1].x * 100,
										y2: points[1].y * 100,
										vectorEffect: "non-scaling-stroke"
									}) : null
								}),
								points.map((point, index) => /* @__PURE__ */ jsx("span", {
									className: MapCalibrationTool_module_default.endpoint,
									style: {
										left: `${point.x * 100}%`,
										top: `${point.y * 100}%`
									},
									children: index + 1
								}, index))
							]
						})
					}),
					/* @__PURE__ */ jsxs("div", {
						className: MapCalibrationTool_module_default.actions,
						children: [
							/* @__PURE__ */ jsx("span", { children: points.length === 0 ? "Click the first endpoint." : points.length === 1 ? "Click the second endpoint." : canSave ? "Reference selected. Save it or click to start again." : "Points are too close. Select a longer reference." }),
							/* @__PURE__ */ jsx("button", {
								type: "button",
								onClick: () => setPoints([]),
								disabled: !points.length,
								children: "Clear points"
							}),
							/* @__PURE__ */ jsx("button", {
								type: "button",
								onClick: () => saveMeasurement(),
								disabled: !canSave,
								children: "Save measurement"
							}),
							/* @__PURE__ */ jsx("button", {
								className: MapCalibrationTool_module_default.primary,
								type: "button",
								onClick: () => saveMeasurement(true),
								disabled: !canSave,
								children: "Save & next map"
							})
						]
					}),
					/* @__PURE__ */ jsx("p", {
						role: "status",
						className: MapCalibrationTool_module_default.status,
						children: status
					})
				] }), /* @__PURE__ */ jsxs("aside", {
					className: MapCalibrationTool_module_default.results,
					children: [
						/* @__PURE__ */ jsxs("h2", { children: [
							completed.length,
							" / ",
							maps.length,
							" maps measured"
						] }),
						/* @__PURE__ */ jsxs("label", { children: ["Baseline map", /* @__PURE__ */ jsxs("select", {
							value: calibration.referenceMapSlug,
							onChange: (event) => persist({
								...calibration,
								referenceMapSlug: event.target.value
							}),
							children: [/* @__PURE__ */ jsx("option", {
								value: "",
								disabled: true,
								children: "Save your first reference"
							}), completed.map((map) => /* @__PURE__ */ jsx("option", {
								value: map.slug,
								children: map.name
							}, map.slug))]
						})] }),
						/* @__PURE__ */ jsx("p", { children: "Factors compare the reference length at the same image display width. The baseline is 1×. Only one floor is needed if the map's floor images share a scale." }),
						/* @__PURE__ */ jsx("ul", { children: maps.map((map) => /* @__PURE__ */ jsx("li", { children: /* @__PURE__ */ jsxs("button", {
							type: "button",
							onClick: () => chooseMap(map.slug),
							"aria-current": map.slug === mapSlug ? "true" : void 0,
							children: [/* @__PURE__ */ jsx("span", { children: map.name }), /* @__PURE__ */ jsx("span", { children: factors[map.slug] ? `${factors[map.slug].toFixed(3)}×` : "Unmeasured" })]
						}) }, map.slug)) }),
						/* @__PURE__ */ jsx("button", {
							className: MapCalibrationTool_module_default.primary,
							type: "button",
							onClick: exportJson,
							disabled: !completed.length,
							children: "Export calibration JSON"
						}),
						/* @__PURE__ */ jsxs("label", {
							className: MapCalibrationTool_module_default.upload,
							children: ["Load calibration JSON", /* @__PURE__ */ jsx("input", {
								type: "file",
								accept: "application/json,.json",
								onChange: (event) => {
									const file = event.target.files?.[0];
									if (file) loadJson(file);
									event.target.value = "";
								}
							})]
						}),
						saved ? /* @__PURE__ */ jsxs("small", { children: ["Saved floor: ", selectedMap.layouts.find((floor) => floor.id === saved.layoutId)?.label ?? saved.layoutId] }) : null
					]
				})]
			})
		]
	});
}
//#endregion
export { MapCalibrationTool };
