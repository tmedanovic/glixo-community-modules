export function createVideoExportAction() {
  return {
    id: 'glixo.interactiveOs.downloadVideo',
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
