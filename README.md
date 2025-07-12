# Autostereogram mirror

## "Magic-eye" yourself in realtime

A toy autostereogram renderer demo in threejs/webgpu, using [depth
estimation](https://huggingface.co/spaces/Xenova/webgpu-realtime-depth-estimation)
to produce the input depth map.

[**Online demo**](https://namuol.github.io/magic-eye-yourself)

![](/screenshot.png)

![](/video.mov)

## Viewing tips

This is a standard "divergent" magic-eye-style autostereogram, which means you
want your eyes to converge "beyond" the image on the screen, while allowing your
eyes to focus on the screen.

Normal autostereograms are hard enough for most people to view, but this demo is
particularly challenging, so don't be discouraged.

Some viewing tips for this demo:

- Try freezing the image while posing in front of your webcam (use the Controls
  UI in the top right of the demo screen)
- Try resizing your window to smaller or larger sizes (you may need to unfreeze
  or refresh the demo after resizing too)
- One method that works for many people: Start with your face right up to the
  image on the screen, then slowly move your head back until the image converges
  into focus

Good luck! 🤓
