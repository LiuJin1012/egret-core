//////////////////////////////////////////////////////////////////////////////////////
//
//  Copyright (c) 2014-2015, Egret Technology Inc.
//  All rights reserved.
//  Redistribution and use in source and binary forms, with or without
//  modification, are permitted provided that the following conditions are met:
//
//     * Redistributions of source code must retain the above copyright
//       notice, this list of conditions and the following disclaimer.
//     * Redistributions in binary form must reproduce the above copyright
//       notice, this list of conditions and the following disclaimer in the
//       documentation and/or other materials provided with the distribution.
//     * Neither the name of the Egret nor the
//       names of its contributors may be used to endorse or promote products
//       derived from this software without specific prior written permission.
//
//  THIS SOFTWARE IS PROVIDED BY EGRET AND CONTRIBUTORS "AS IS" AND ANY EXPRESS
//  OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES
//  OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED.
//  IN NO EVENT SHALL EGRET AND CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT,
//  INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
//  LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;LOSS OF USE, DATA,
//  OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
//  LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
//  NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE,
//  EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
//
//////////////////////////////////////////////////////////////////////////////////////

module egret.web {

    var blendModes = ["source-over", "lighter", "destination-out"];
    var defaultCompositeOp = "source-over";
    var renderBufferPool:CanvasRenderBuffer[] = [];//渲染缓冲区对象池
    var nestLevel = 0;//渲染的嵌套层次，0表示在调用堆栈的最外层。

    /**
     * @private
     * Canvas渲染器
     */
    export class CanvasRenderer implements sys.SystemRenderer {

        public constructor() {

        }

        /**
         * 渲染一个显示对象
         * @param displayObject 要渲染的显示对象
         * @param  渲染目标
         * @param matrix 要对显示对象整体叠加的变换矩阵
         * @returns drawCall触发绘制的次数
         */
        public render(displayObject:DisplayObject, buffer:CanvasRenderBuffer, matrix?:Matrix, dirtyList?:egret.sys.Region[]):number {
            nestLevel++
            var context = buffer.context;
            //绘制显示对象
            return this.drawDisplayObject(displayObject, context, dirtyList, matrix, null, null);
            nestLevel--;
            if(nestLevel===0){
                //最大缓存6个渲染缓冲
                if(renderBufferPool.length>6){
                    renderBufferPool.length = 6;
                }
                var length = renderBufferPool.length;
                for(var i=0;i<length;i++){
                    renderBufferPool[i].resize(0,0);
                }
            }
        }

        /**
         * @private
         * 绘制一个显示对象
         */
        private drawDisplayObject(displayObject:DisplayObject, context:CanvasRenderingContext2D, dirtyList:egret.sys.Region[],
                                  rootMatrix:Matrix, displayList:sys.DisplayList, clipRegion:sys.Region):number {
            var drawCalls = 0;
            var node:sys.RenderNode;
            var globalAlpha:number;
            if (displayList) {
                if (displayList.isDirty) {
                    drawCalls += displayList.drawToSurface();
                }
                node = displayList.$renderNode;
                globalAlpha = 1;//这里不用读取node.renderAlpha,因为它已经绘制到了displayList.surface的内部。
            }
            else if (displayObject.$renderNode) {
                node = displayObject.$renderNode;
                globalAlpha = node.renderAlpha;
            }
            if (node) {
                var renderRegion = node.renderRegion;
                if (clipRegion && !clipRegion.intersects(renderRegion)) {
                    node.needRedraw = false;
                }
                else if (!node.needRedraw) {
                    if (dirtyList) {
                        var l = dirtyList.length;
                        for (var j = 0; j < l; j++) {
                            if (renderRegion.intersects(dirtyList[j])) {
                                node.needRedraw = true;
                                break;
                            }
                        }
                    }
                    else {
                        node.needRedraw = true;
                    }
                }
                if (node.needRedraw) {
                    drawCalls++;
                    context.globalAlpha = globalAlpha;
                    var m = node.renderMatrix;
                    if (rootMatrix) {
                        context.setTransform(rootMatrix.a, rootMatrix.b, rootMatrix.c, rootMatrix.d, rootMatrix.tx, rootMatrix.ty);
                        context.transform(m.a, m.b, m.c, m.d, m.tx, m.ty);

                    }
                    else {//绘制到舞台上时，所有矩阵都是绝对的，不需要调用transform()叠加。
                        context.setTransform(m.a, m.b, m.c, m.d, m.tx, m.ty);
                    }
                    this.doRender(context, node);
                    node.needRedraw = false;
                }
            }
            if (displayList) {
                return drawCalls;
            }
            var children = displayObject.$children;
            if (children) {
                var length = children.length;
                for (var i = 0; i < length; i++) {
                    var child = children[i];
                    if (!child.$visible || child.$alpha <= 0 || child.$maskedObject) {
                        continue;
                    }
                    if ((child.$blendMode !== 0 ||
                        (child.$mask && child.$mask.$parentDisplayList)) &&//若遮罩不在显示列表中，放弃绘制遮罩。
                        child.$displayList) {//若没有开启缓存，放弃绘制遮罩和混合模式。
                        drawCalls += this.drawWithClip(child, context, dirtyList, rootMatrix, clipRegion);
                    }
                    else if (child.$scrollRect || child.$maskRect) {
                        drawCalls += this.drawWithScrollRect(child, context, dirtyList, rootMatrix, clipRegion);
                    }
                    else {
                        if (child["isFPS"]) {
                            this.drawDisplayObject(child, context, dirtyList, rootMatrix, child.$displayList, clipRegion);
                        }
                        else {
                            drawCalls += this.drawDisplayObject(child, context, dirtyList, rootMatrix, child.$displayList, clipRegion);
                        }
                    }
                }
            }
            return drawCalls;
        }

        /**
         * @private
         */
        private drawWithClip(displayObject:DisplayObject, context:CanvasRenderingContext2D, dirtyList:egret.sys.Region[],
                             rootMatrix:Matrix, clipRegion:sys.Region):number {
            var drawCalls = 0;
            var hasBlendMode = (displayObject.$blendMode !== 0);
            if (hasBlendMode) {
                var compositeOp = blendModes[displayObject.$blendMode];
                if (!compositeOp) {
                    compositeOp = defaultCompositeOp;
                }
            }

            var scrollRect = displayObject.$scrollRect ? displayObject.$scrollRect : displayObject.$maskRect;
            var mask = displayObject.$mask;
            if (mask && !mask.$parentDisplayList) {
                mask = null; //如果遮罩不在显示列表中，放弃绘制遮罩。
            }

            //计算scrollRect和mask的clip区域是否需要绘制，不需要就直接返回，跳过所有子项的遍历。
            var maskRegion:sys.Region;
            var displayMatrix = Matrix.create();
            displayMatrix.copyFrom(displayObject.$getConcatenatedMatrix());
            var root = displayObject.$parentDisplayList.root;
            var invertedMatrix:Matrix;
            if (root !== displayObject.$stage) {
                invertedMatrix = root.$getInvertedConcatenatedMatrix();
                invertedMatrix.$preMultiplyInto(displayMatrix, displayMatrix);
            }

            if (mask) {
                var bounds = mask.$getOriginalBounds();
                maskRegion = sys.Region.create();
                var m = Matrix.create();
                m.copyFrom(mask.$getConcatenatedMatrix());
                if (invertedMatrix) {
                    invertedMatrix.$preMultiplyInto(m, m);
                }
                maskRegion.updateRegion(bounds, m);
                Matrix.release(m);
            }
            var region:sys.Region;
            if (scrollRect) {
                region = sys.Region.create();
                region.updateRegion(scrollRect, displayMatrix);
            }
            if (region && maskRegion) {
                region.intersect(maskRegion);
                sys.Region.release(maskRegion);
            }
            else if (!region && maskRegion) {
                region = maskRegion;
            }
            if (region) {
                if (region.isEmpty() || (clipRegion && !clipRegion.intersects(region))) {
                    sys.Region.release(region);
                    Matrix.release(displayMatrix);
                    return drawCalls;
                }
            }
            else {
                region = sys.Region.create();
                bounds = displayObject.$getOriginalBounds();
                region.updateRegion(bounds, displayMatrix);
            }
            var found = false;
            var l = dirtyList.length;
            for (var j = 0; j < l; j++) {
                if (region.intersects(dirtyList[j])) {
                    found = true;
                    break;
                }
            }
            if (!found) {
                sys.Region.release(region);
                Matrix.release(displayMatrix);
                return drawCalls;
            }

            //绘制显示对象自身，若有scrollRect，应用clip
            var displayBuffer = this.createRenderBuffer(region.width, region.height);
            var displayContext = displayBuffer.context;
            if (!displayContext) {//RenderContext创建失败，放弃绘制遮罩。
                drawCalls += this.drawDisplayObject(displayObject, context, dirtyList, rootMatrix, displayObject.$displayList, clipRegion);
                sys.Region.release(region);
                Matrix.release(displayMatrix);
                return drawCalls;
            }
            if (scrollRect) {
                var m = displayMatrix;
                displayContext.setTransform(m.a, m.b, m.c, m.d, m.tx - region.minX, m.ty - region.minY);
                displayContext.beginPath();
                displayContext.rect(scrollRect.x, scrollRect.y, scrollRect.width, scrollRect.height);
                displayContext.clip();
            }
            displayContext.setTransform(1, 0, 0, 1, -region.minX, -region.minY);
            var rootM = Matrix.create().setTo(1, 0, 0, 1, -region.minX, -region.minY);
            drawCalls += this.drawDisplayObject(displayObject, displayContext, dirtyList, rootM, displayObject.$displayList, region);
            Matrix.release(rootM);
            //绘制遮罩
            if (mask) {
                var maskBuffer = this.createRenderBuffer(region.width, region.height);
                var maskContext = maskBuffer.context;
                if (!maskContext) {//RenderContext创建失败，放弃绘制遮罩。
                    drawCalls += this.drawDisplayObject(displayObject, context, dirtyList, rootMatrix, displayObject.$displayList, clipRegion);
                    renderBufferPool.push(displayBuffer);
                    sys.Region.release(region);
                    Matrix.release(displayMatrix);
                    return drawCalls;
                }
                maskContext.setTransform(1, 0, 0, 1, -region.minX, -region.minY);
                rootM = Matrix.create().setTo(1, 0, 0, 1, -region.minX, -region.minY);
                var calls = this.drawDisplayObject(mask, maskContext, dirtyList, rootM, mask.$displayList, region);
                Matrix.release(rootM);
                if (calls > 0) {
                    drawCalls += calls;
                    displayContext.globalCompositeOperation = "destination-in";
                    displayContext.setTransform(1, 0, 0, 1, 0, 0);
                    displayContext.globalAlpha = 1;
                    displayContext.drawImage(<any>maskBuffer.surface, 0, 0);
                }
                renderBufferPool.push(maskBuffer);
            }


            //绘制结果到屏幕
            if (drawCalls > 0) {
                drawCalls++;
                if (hasBlendMode) {
                    context.globalCompositeOperation = compositeOp;
                }
                context.globalAlpha = 1;
                if (rootMatrix) {
                    context.translate(region.minX, region.minY);
                    context.drawImage(<any>displayBuffer.surface, 0, 0);
                    context.setTransform(rootMatrix.a, rootMatrix.b, rootMatrix.c, rootMatrix.d, rootMatrix.tx, rootMatrix.ty);
                }
                else {//绘制到舞台上时，所有矩阵都是绝对的，不需要调用transform()叠加。
                    context.setTransform(1, 0, 0, 1, region.minX, region.minY);
                    context.drawImage(<any>displayBuffer.surface, 0, 0);
                }

                if (hasBlendMode) {
                    context.globalCompositeOperation = defaultCompositeOp;
                }
            }
            renderBufferPool.push(displayBuffer);
            sys.Region.release(region);
            Matrix.release(displayMatrix);
            return drawCalls;
        }

        /**
         * @private
         */
        private drawWithScrollRect(displayObject:DisplayObject, context:CanvasRenderingContext2D, dirtyList:egret.sys.Region[],
                                   rootMatrix:Matrix, clipRegion:sys.Region):number {
            var drawCalls = 0;
            var scrollRect = displayObject.$scrollRect ? displayObject.$scrollRect : displayObject.$maskRect;
            if (scrollRect.width == 0 || scrollRect.height == 0) {
                return drawCalls;
            }
            var m = Matrix.create();
            m.copyFrom(displayObject.$getConcatenatedMatrix());
            var root = displayObject.$parentDisplayList.root;
            if (root !== displayObject.$stage) {
                root.$getInvertedConcatenatedMatrix().$preMultiplyInto(m, m)
            }
            var region:sys.Region = sys.Region.create();
            if (!scrollRect.isEmpty()) {
                region.updateRegion(scrollRect, m);
            }
            if (region.isEmpty() || (clipRegion && !clipRegion.intersects(region))) {
                sys.Region.release(region);
                Matrix.release(m);
                return drawCalls;
            }
            var found = false;
            var l = dirtyList.length;
            for (var j = 0; j < l; j++) {
                if (region.intersects(dirtyList[j])) {
                    found = true;
                    break;
                }
            }
            if (!found) {
                sys.Region.release(region);
                Matrix.release(m);
                return drawCalls;
            }

            //绘制显示对象自身
            context.save();
            if (rootMatrix) {
                context.setTransform(rootMatrix.a, rootMatrix.b, rootMatrix.c, rootMatrix.d, rootMatrix.tx, rootMatrix.ty);
                context.transform(m.a, m.b, m.c, m.d, m.tx, m.ty);
            }
            else {
                context.setTransform(m.a, m.b, m.c, m.d, m.tx, m.ty);
            }
            context.beginPath();
            context.rect(scrollRect.x, scrollRect.y, scrollRect.width, scrollRect.height);
            context.clip();
            drawCalls += this.drawDisplayObject(displayObject, context, dirtyList, rootMatrix, displayObject.$displayList, region);
            context.restore()

            sys.Region.release(region);
            Matrix.release(m);
            return drawCalls;
        }

        private doRender(context:CanvasRenderingContext2D, node:sys.RenderNode):void {
            switch (node.type) {
                case sys.RenderNodeType.BitmapNode:
                    var bitmapNode = <sys.BitmapNode>node;
                    var image = bitmapNode.image;
                    context["imageSmoothingEnabled"] = bitmapNode.smoothing;
                    var data = bitmapNode.drawData;
                    var length = data.length;
                    for (var i = 0; i < length; i += 8) {
                        context.drawImage(<HTMLImageElement><any>image, data[i], data[i + 1], data[i + 2], data[i + 3], data[i + 4], data[i + 5], data[i + 6], data[i + 7]);
                    }
                    break;
            }
        }

        /**
         * @private
         */
        private createRenderBuffer(width:number, height:number):CanvasRenderBuffer {
            //在chrome里，小等于256*256的canvas会不启用GPU加速。
            width = Math.max(257, width);
            height = Math.max(257, height);
            var buffer = renderBufferPool.pop();
            if(buffer){
                buffer.resize(width,height,true);
            }
            else{
                buffer = new CanvasRenderBuffer(width,height);
            }
            return buffer;
        }
    }
}