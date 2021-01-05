

import {Renderer} from "./src/renderer/Renderer.js";
import {Camera} from "./src/scene/Camera.js";
import {mat4, vec3} from './libs/gl-matrix.js';
import {OrbitControls} from "./src/navigation/OrbitControls.js";
import {Lines} from "./src/modules/lines/Lines.js";
import {render as renderLines} from "./src/modules/lines/render.js";
import {Geometry} from "./src/core/Geometry.js";
import {Vector3} from "./src/math/Vector3.js";

import {Potree} from "./src/Potree.js";

import {render as renderQuads}  from "./src/potree/renderQuads.js";
import {render as renderPoints}  from "./src/potree/renderPoints.js";

let frame = 0;
let lastFrameStart = 0;
let lastFpsCount = 0;
let framesSinceLastCount = 0;
let fps = 0;

let primitiveType = "points";

async function run(){

	let renderer = new Renderer();

	window.renderer = renderer;

	await renderer.init();

	let camera = new Camera();

	let controls = new OrbitControls(renderer.canvas);
	// controls.radius = 30;
	// controls.yaw = Math.PI / 4;
	// controls.pitch = Math.PI / 5;

	Potree.load("./resources/pointclouds/lion/metadata.json").then(pointcloud => {

		controls.radius = 10;
		controls.yaw = -Math.PI / 6;
		controls.pitch = Math.PI / 5;

		pointcloud.updateVisibility(camera);
		pointcloud.position.set(-0.9, 0.1, -5);
		pointcloud.updateWorld();
		window.pointcloud = pointcloud;
	});

	// Potree.load("./resources/pointclouds/heidentor/metadata.json").then(pointcloud => {
	// 	controls.radius = 30;
	// 	controls.yaw = Math.PI / 4;
	// 	controls.pitch = Math.PI / 5;
	//
	// 	pointcloud.updateVisibility(camera);
	// 	pointcloud.position.set(3, -3, -6)
	// 	pointcloud.updateWorld();
	// 	window.pointcloud = pointcloud;
	// });

	{
		let elPoints = document.getElementById("btn_points");
		let elQuads = document.getElementById("btn_quads");

		elPoints.addEventListener("click", () => {
			console.log("points!!");
			primitiveType = "points";
		});

		elQuads.addEventListener("click", () => {
			console.log("quads!!");
			primitiveType = "quads";
		});
	}

	let lines = null;
	{
		let geometry = new Geometry();
		geometry.buffers = [{
			name: "position",
			buffer: new Float32Array([
				-1, -1, -1,
				1, 1, 1,
				0, 0, 0,
				6, 3, 1
			]),
		}];
		geometry.numElements = 4;

		lines = new Lines("test", geometry);

	}
	

	let loop = () => {
		// let timeSinceLastFrame = performance.now() - lastFrameStart;
		// console.log(timeSinceLastFrame.toFixed(1));
		// lastFrameStart = performance.now();
		let now = performance.now();

		if((now - lastFpsCount) >= 1000.0){

			fps = framesSinceLastCount;

			lastFpsCount = now;
			framesSinceLastCount = 0;
			document.getElementById("lbl_fps").innerText = Math.floor(fps);
		}
		

		frame++;
		framesSinceLastCount++;

		controls.update();
		mat4.copy(camera.world, controls.world);
		camera.updateView();

		let size = renderer.getSize();
		camera.aspect = size.width / size.height;
		camera.updateProj();

		{ // draw to window
			let pass = renderer.start();

			if(window.pointcloud){
				window.pointcloud.updateVisibility(camera);

				let numPoints = pointcloud.visibleNodes.map(n => n.geometry.numElements).reduce( (a, i) => a + i, 0);
				let numNodes = pointcloud.visibleNodes.length;

				document.getElementById("lbl_points").innerText = numPoints.toLocaleString();
				document.getElementById("lbl_nodes").innerText = numNodes.toLocaleString();

				//Potree.render(renderer, pass, window.pointcloud, camera);

				if(primitiveType === "points"){
					renderPoints(renderer, pass, window.pointcloud, camera);
				}else if(primitiveType === "quads"){
					renderQuads(renderer, pass, window.pointcloud, camera);
				}
			}

			if(lines){
					renderLines(renderer, pass, lines, camera);
			}

			for(let i = 0; i < 1000; i++){
				renderer.drawBoundingBox(
					new Vector3(
						10 * Math.random(),
						10 * Math.random(),
						10 * Math.random(),
					), 
					new Vector3(1, 1, 1), 
					new Vector3(1, 0, 1)
				);
			}
			

			renderer.renderDrawCommands(pass, camera);
			renderer.finish(pass);
		}

		requestAnimationFrame(loop);
	};
	requestAnimationFrame(loop);

}


run();





