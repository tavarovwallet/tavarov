export async function readBoundedBody(request, byteLimit){
  if (Number(request.headers.get('content-length')) > byteLimit) return { tooBig: true };
  if (!request.body) return { text: '' };

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  try{
    while (true){
      const { done, value } = await reader.read();
      if (done) return { text: text + decoder.decode() };
      bytes += value.byteLength;
      if (bytes > byteLimit){
        void reader.cancel().catch(() => {});
        return { tooBig: true };
      }
      text += decoder.decode(value, { stream: true });
    }
  } catch(e){ return { bad: true }; }
  finally { reader.releaseLock(); }
}
