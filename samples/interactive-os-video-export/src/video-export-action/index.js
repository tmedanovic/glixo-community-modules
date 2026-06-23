export function createVideoExportAction() {
  return {
    id: 'glixo.interactiveOs.video.export',
    title: 'Download video',
    async run(context) {
      return {
        ok: true,
        sessionId: context?.sessionId ?? null,
        message: 'Video export action invoked.',
      };
    },
  };
}
