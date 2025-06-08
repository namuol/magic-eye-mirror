struct VertexInput {
    @location(0) position: vec4<f32>,
    @location(1) uv: vec2<f32>,
};

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) vUvs: vec2<f32>,
};

@group(0) @binding(0)
var<uniform> projectionMatrix: mat4x4<f32>;

@group(0) @binding(1)
var<uniform> modelViewMatrix: mat4x4<f32>;

@vertex
fn main(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;
    output.position = projectionMatrix * modelViewMatrix * input.position;
    output.vUvs = input.uv;
    return output;
} 