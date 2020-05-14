

let vs = `
#version 450

layout(set = 0, binding = 0) uniform Uniforms {
	mat4 worldViewProj;
	ivec4 imin;
	vec4 offset;
	float screenWidth;
	float screenHeight;
	vec4 fScale;
	ivec4 iScale;
} uniforms;

layout(location = 0) in ivec3 a_position;
layout(location = 1) in ivec4 a_rgb;

layout(location=2) in vec3 posBillboard;

layout(location = 0) out vec4 vColor;

void main() {
	vColor = vec4(
		float(a_rgb.x) / 256.0,
		float(a_rgb.y) / 256.0,
		float(a_rgb.z) / 256.0,
		1.0
	);

	ivec3 ipos = a_position / uniforms.iScale.xyz;
	vec3 pos = vec3(ipos) * uniforms.fScale.xyz;

	pos = pos + uniforms.offset.xyz;

	gl_Position = uniforms.worldViewProj * vec4(pos, 1.0);

	float w = gl_Position.w;
	float pointSize = 5.0;
	gl_Position.x += w * pointSize * posBillboard.x / uniforms.screenWidth;
	gl_Position.y += w * pointSize * posBillboard.y / uniforms.screenHeight;

}
`;


let fs = `

#version 450

layout(location = 0) in vec4 vColor;
layout(location = 0) out vec4 outColor;

void main() {
	outColor = vColor;
	// outColor = vec4(1.0, 0.0, 0.0, 1.0);
}

`;

let shader = null;

let billboardBuffer = null;
function getBillboardBuffer(device){

	if(billboardBuffer === null){
		let values = [
			-1, -1, 0,
			1, -1, 0,
			1, 1, 0,
			-1, 1, 0
		];

		const [gpuBuffer, mapping] = device.createBufferMapped({
			size: values.length * 4,
			usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
		});
		new Float32Array(mapping).set(values);
		gpuBuffer.unmap();

		billboardBuffer = gpuBuffer;

	}

	return billboardBuffer;
}

export function initializePointCloudOctreePipeline(octree){
	let {device} = this;

	let bindGroupLayout = device.createBindGroupLayout({
		entries: [{
			binding: 0,
			visibility: GPUShaderStage.VERTEX,
			type: "uniform-buffer"
		}]
	});

	let pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });

	let pipeline = device.createRenderPipeline({
		layout: pipelineLayout,
		vertexStage: {
			module: shader.vsModule,
			entryPoint: 'main'
		},
		fragmentStage: {
			module: shader.fsModule,
			entryPoint: 'main'
		},
		vertexState: {
			vertexBuffers: [
				{
					arrayStride: 3 * 4,
					stepMode: "instance",
					attributes: [
						{ // position
							shaderLocation: 0,
							offset: 0,
							format: "int3"
						}
					]
				},{
					arrayStride: 1 * 4,
					stepMode: "instance",
					attributes: [
						{ // color
							shaderLocation: 1,
							offset: 0,
							format: "uchar4"
						}
					]
				},{
					arrayStride: 4 * 4,
					attributes: [
						{ // billboard position
							shaderLocation: 2,
							offset: 0,
							format: "float4"
						}
					]
				}
			]
		},
		colorStates: [
			{
				format: this.swapChainFormat,
				alphaBlend: {
					srcFactor: "src-alpha",
					dstFactor: "one-minus-src-alpha",
					operation: "add"
				}
			}
		],
		primitiveTopology: 'triangle-strip',
		rasterizationState: {
			frontFace: "ccw",
			cullMode: 'none'
		},
		depthStencilState: {
			depthWriteEnabled: true,
			depthCompare: "less",
			format: "depth24plus-stencil8",
		}
	});

	return {
		pipeline: pipeline,
		bindGroupLayout: bindGroupLayout,
	};
}

export function initializePointCloudOctreeUniforms(octree, bindGroupLayout){
	let {device} = this;

	const uniformBufferSize = 4 * 16 + 16 + 16 + 16+ 16 + 16;

	let buffer = device.createBuffer({
		size: uniformBufferSize,
		usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
	});

	let bindGroup = device.createBindGroup({
		layout: bindGroupLayout,
		entries: [{
			binding: 0,
			resource: {
				buffer: buffer,
			},
		}],
	});

	let uniforms = {
		buffer: buffer,
		bindGroup: bindGroup,
		bindGroupLayout: bindGroupLayout,
	};

	return uniforms;
}

function getScaleComponents(scale){

	let iScale = new Int32Array([1, 1, 1]);
	let fScale = new Float32Array([0, 0, 0]);

	for(let i = 0; i < 3; i++){
		if(scale[i] < 0.0001){
			iScale[i] = 1000;
			fScale[i] = scale[i] * 1000;
		}else{
			fScale[i] = scale[i];
		}
	}
	
	return [iScale, fScale];
}

export function renderPointCloudOctree(octree, view, proj, passEncoder){

	if(shader === null){
		shader = {
			vsModule: this.makeShaderModule('vertex', vs),
			fsModule: this.makeShaderModule('fragment', fs),
		};

		return;
	}

	if(!octree.webgpu){
		let {pipeline, bindGroupLayout} = initializePointCloudOctreePipeline.bind(this)(octree);
		let uniforms = initializePointCloudOctreeUniforms.bind(this)(octree, bindGroupLayout);

		octree.webgpu = {
			pipeline: pipeline,
			bindGroupLayout: bindGroupLayout,
			uniforms: uniforms,
		};
	}

	let {device} = this;
	let {webgpu} = octree;
	let {pipeline, uniforms} = webgpu;

	let transform = mat4.create();
	let scale = mat4.create();
	let translate = mat4.create();
	let worldView = mat4.create();
	let worldViewProj = mat4.create();
	let identity = mat4.create();

	passEncoder.setPipeline(pipeline);

	for(let node of octree.visibleNodes){
		if(!node.webgpu){
			let buffers = this.initializeBuffers(node);

			node.webgpu = {
				buffers: buffers,
			};
		}

		let webgpuNode = node.webgpu;
		let {buffers} = webgpuNode;

		mat4.scale(scale, identity, octree.scale.toArray());
		mat4.translate(translate, identity, octree.position.toArray());
		mat4.multiply(transform, translate, scale);

		mat4.multiply(worldView, view, transform);
		mat4.multiply(worldViewProj, proj, worldView);

		let [width, height] = [this.canvas.clientWidth, this.canvas.clientHeight];

		
		let offsets = new Float32Array(octree.loader.offset);
		let screenSize = new Float32Array([width, height]);
		let [iScale, fScale] = getScaleComponents(octree.loader.scale);
		//let fScale = new Float32Array(octree.loader.scale);

		uniforms.buffer.setSubData(0, worldViewProj);
		uniforms.buffer.setSubData(64, new Int32Array([0, 0, 0, 0]));
		uniforms.buffer.setSubData(80, offsets);
		uniforms.buffer.setSubData(96, screenSize);
		uniforms.buffer.setSubData(112, fScale);
		uniforms.buffer.setSubData(128, iScale);

		let bufPos = buffers.find(b => b.name === "position");
		let bufCol = buffers.find(b => b.name === "rgb");
		passEncoder.setVertexBuffer(0, bufPos.handle);
		passEncoder.setVertexBuffer(1, bufCol.handle);
		passEncoder.setVertexBuffer(2, getBillboardBuffer(device));
		
		passEncoder.setBindGroup(0, uniforms.bindGroup);

		passEncoder.draw(4, node.numPoints, 0, 0);

	}

}