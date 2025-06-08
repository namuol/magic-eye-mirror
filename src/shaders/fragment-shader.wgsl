struct FragmentInput {
    @location(0) vUvs: vec2<f32>,
};

@fragment
fn main(input: FragmentInput) -> @location(0) vec4<f32> {
    return vec4<f32>(input.vUvs, 0.0, 1.0);
} 